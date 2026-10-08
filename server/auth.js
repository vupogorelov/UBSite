// @ts-check
// Accounts, sessions, one-time invitation links and workspace roles. Built on node:crypto only.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError } from './http.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('node:http').IncomingMessage} Req */
/**
 * Platform roles (isTranslator, isCoordinator) govern the public translation layer;
 * workspace roles (Role) govern notes inside a workspace.
 * @typedef {{ id: number, username: string, displayName: string | null, isAdmin: boolean, isTranslator: boolean, isCoordinator: boolean }} User
 */
/** @typedef {'owner' | 'editor' | 'commenter' | 'viewer'} Role */

export const SESSION_COOKIE = 'ub_session';
export const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
export const ROLES = /** @type {const} */ (['viewer', 'commenter', 'editor', 'owner']);
export const roleRank = (/** @type {Role} */ r) => ROLES.indexOf(r);

// ---- Passwords: scrypt with a per-password salt, "scrypt$<salt>$<hash>" ----

/** @param {string} password */
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`;
}

/** @param {string} password @param {string | null} stored */
export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) {
    scryptSync(password, 'timing', 64); // same cost when the user has no password yet
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** @param {unknown} p */
export function checkNewPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw new HttpError(400, 'Пароль: не короче 8 символов');
  if (p.length > 200) throw new HttpError(400, 'Слишком длинный пароль');
  return p;
}

/** @param {unknown} u */
export function checkUsername(u) {
  if (typeof u !== 'string' || !/^[\p{L}\p{N}_.-]{2,40}$/u.test(u.trim())) {
    throw new HttpError(400, 'Имя пользователя: 2–40 символов, буквы, цифры, _ . -');
  }
  return u.trim();
}

/** Random token for links and cookies; only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (/** @type {string} */ t) => createHash('sha256').update(t).digest('hex');

const sqlTime = (/** @type {Date} */ d) => d.toISOString().slice(0, 19).replace('T', ' ');
const daysFromNow = (/** @type {number} */ days) => sqlTime(new Date(Date.now() + days * 86_400_000));

/** @param {Req} req @param {string} name */
export function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Requests come straight from the browser or through Caddy on the same machine. @param {Req} req */
export function viaLocalProxy(req) {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** @param {Req} req */
export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return viaLocalProxy(req) && fwd ? fwd : req.socket.remoteAddress ?? '?';
}

/** @param {Req} req */
export function isHttps(req) {
  return process.env.UB_SECURE_COOKIES === '1' || (viaLocalProxy(req) && req.headers['x-forwarded-proto'] === 'https');
}

/** @param {Req} req */
export function publicOrigin(req) {
  if (process.env.UB_PUBLIC_URL) return process.env.UB_PUBLIC_URL.replace(/\/$/, '');
  const host = (viaLocalProxy(req) && req.headers['x-forwarded-host']) || req.headers.host || '127.0.0.1';
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}

/** @param {Req} req @param {string | null} token */
export function sessionCookie(req, token) {
  const parts = [`${SESSION_COOKIE}=${token ?? ''}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${token ? SESSION_DAYS * 86400 : 0}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

/** Simple in-memory limiter for failed logins: 10 failures per key per 15 minutes. */
export function createLoginLimiter() {
  /** @type {Map<string, number[]>} */
  const failures = new Map();
  const WINDOW = 15 * 60_000;
  return {
    /** @param {string} key */
    check(key) {
      const recent = (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW);
      failures.set(key, recent);
      if (recent.length >= 10) throw new HttpError(429, 'Слишком много попыток входа, попробуйте через 15 минут');
    },
    /** @param {string} key */
    fail(key) {
      failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
    },
    /** @param {string} key */
    reset(key) {
      failures.delete(key);
    },
  };
}

/** @param {DatabaseSync} db */
export function createAuth(db) {
  const q = {
    userByKey: db.prepare(
      `SELECT id, username, display_name AS displayName, password_hash, is_admin AS isAdmin, is_translator AS isTranslator,
              is_coordinator AS isCoordinator, disabled FROM users WHERE username_key = ?`,
    ),
    userById: db.prepare(
      `SELECT id, username, display_name AS displayName, is_admin AS isAdmin, is_translator AS isTranslator,
              is_coordinator AS isCoordinator, disabled FROM users WHERE id = ?`,
    ),
    insertUser: db.prepare(
      'INSERT INTO users (username, username_key, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?) RETURNING id',
    ),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    session: db.prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.is_admin AS isAdmin, u.is_translator AS isTranslator,
              u.is_coordinator AS isCoordinator, s.expires_at AS expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.disabled = 0 AND s.expires_at > datetime('now')`,
    ),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    extendSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    insertInvite: db.prepare(
      `INSERT INTO invites (token_hash, kind, user_id, workspace_id, role, is_admin, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    invite: db.prepare(
      `SELECT i.kind, i.user_id AS userId, i.workspace_id AS workspaceId, i.role, i.is_admin AS isAdmin,
              u.username, w.name AS workspaceName
       FROM invites i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > datetime('now')`,
    ),
    useInvite: db.prepare("UPDATE invites SET used_at = datetime('now') WHERE token_hash = ?"),
    insertWorkspace: db.prepare("INSERT INTO workspaces (name, kind, owner_id) VALUES ('Личное', 'personal', ?) RETURNING id"),
    addMember: db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
    ),
    role: db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'),
  };

  /** @param {any} row @returns {User} */
  const toUser = (row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName ?? null,
    isAdmin: Boolean(row.isAdmin),
    isTranslator: Boolean(row.isTranslator),
    isCoordinator: Boolean(row.isCoordinator),
  });

  return {
    /** Session user for a cookie token, extending the session when it is past half of its life. @param {string | null} token */
    userForToken(token) {
      if (!token) return null;
      const h = tokenHash(token);
      const row = /** @type {any} */ (q.session.get(h));
      if (!row) return null;
      if (Date.parse(row.expiresAt.replace(' ', 'T') + 'Z') - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
        q.extendSession.run(daysFromNow(SESSION_DAYS), h);
      }
      return toUser(row);
    },

    /** @param {number} userId */
    createSession(userId) {
      q.purgeSessions.run();
      const token = newToken();
      q.insertSession.run(tokenHash(token), userId, daysFromNow(SESSION_DAYS));
      return token;
    },

    /** @param {string} token */
    endSession(token) {
      q.deleteSession.run(tokenHash(token));
    },

    /** @param {string} username @param {string} password @returns {User | null} */
    login(username, password) {
      const row = /** @type {any} */ (q.userByKey.get(username.trim().toLowerCase()));
      const ok = verifyPassword(password, row?.password_hash ?? null);
      if (!row || !ok || row.disabled) return null;
      return toUser(row);
    },

    /** @param {number} id @returns {(User & { disabled: boolean }) | null} */
    userById(id) {
      const row = /** @type {any} */ (q.userById.get(id));
      return row ? { ...toUser(row), disabled: Boolean(row.disabled) } : null;
    },

    /** @param {number} userId @param {string} password */
    setPassword(userId, password) {
      q.setPassword.run(hashPassword(password), userId);
      q.deleteUserSessions.run(userId);
    },

    /** @param {number} userId */
    endAllSessions(userId) {
      q.deleteUserSessions.run(userId);
    },

    /**
     * A new account with its personal workspace.
     * @param {string} username @param {string | null} displayName @param {string | null} password @param {boolean} isAdmin
     */
    createUser(username, displayName, password, isAdmin) {
      const key = username.toLowerCase();
      if (q.userByKey.get(key)) throw new HttpError(409, `Имя «${username}» уже занято`);
      const { id } = /** @type {{ id: number }} */ (
        q.insertUser.get(username, key, displayName, password ? hashPassword(password) : null, isAdmin ? 1 : 0)
      );
      const ws = /** @type {{ id: number }} */ (q.insertWorkspace.get(id));
      q.addMember.run(ws.id, id, 'owner');
      return id;
    },

    /**
     * One-time link token. kind "account": a new user (optionally joining a workspace); "reset": new password.
     * @param {{ kind: 'account' | 'reset', userId?: number | null, workspaceId?: number | null, role?: Role | null, isAdmin?: boolean, createdBy?: number | null }} inv
     */
    createInvite(inv) {
      const token = newToken();
      q.insertInvite.run(
        tokenHash(token), inv.kind, inv.userId ?? null, inv.workspaceId ?? null, inv.role ?? null,
        inv.isAdmin ? 1 : 0, inv.createdBy ?? null, daysFromNow(INVITE_DAYS),
      );
      return token;
    },

    /** @param {string} token */
    invite(token) {
      return /** @type {any} */ (q.invite.get(tokenHash(token))) ?? null;
    },

    /** @param {string} token */
    useInvite(token) {
      q.useInvite.run(tokenHash(token));
    },

    /** @param {number} workspaceId @param {number} userId @param {Role} role */
    addMember(workspaceId, userId, role) {
      q.addMember.run(workspaceId, userId, role);
    },

    /** Role of the user in the workspace, or null. @param {number} workspaceId @param {number} userId @returns {Role | null} */
    role(workspaceId, userId) {
      return /** @type {{ role: Role } | undefined} */ (q.role.get(workspaceId, userId))?.role ?? null;
    },

    /**
     * Throws 404 when the user is not a member (no hint that the workspace exists), 403 when the role is too low.
     * @param {number} workspaceId @param {User} user @param {Role} min
     */
    require(workspaceId, user, min) {
      const r = Number.isInteger(workspaceId) ? this.role(workspaceId, user.id) : null;
      if (!r) throw new HttpError(404, 'Рабочее пространство не найдено');
      if (roleRank(r) < roleRank(min)) throw new HttpError(403, 'Недостаточно прав в этом пространстве');
      return r;
    },
  };
}
