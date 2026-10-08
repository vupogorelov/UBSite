// @ts-check
// Login, logout, current user, invitation links, password change. These routes work without a session.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import { SESSION_COOKIE, readCookie, sessionCookie, clientIp, checkNewPassword, checkUsername, createLoginLimiter } from '../auth.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 */
export function registerAuthRoutes(router, db, auth) {
  const limiter = createLoginLimiter();
  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});

  /** Current user or 401 (these routes run before the global session check). @param {import('node:http').IncomingMessage} req */
  const current = (req) => {
    const user = auth.userForToken(readCookie(req, SESSION_COOKIE));
    if (!user) throw new HttpError(401, 'Требуется вход');
    return user;
  };

  router.on('POST', '/api/auth/login', async ({ req, res }) => {
    const b = await body(req);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const key = `${clientIp(req)}|${username.toLowerCase()}`;
    limiter.check(key);
    limiter.check(clientIp(req));
    const user = auth.login(username, typeof b.password === 'string' ? b.password : '');
    if (!user) {
      limiter.fail(key);
      limiter.fail(clientIp(req));
      throw new HttpError(401, 'Неверное имя или пароль');
    }
    limiter.reset(key);
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(user.id)));
    return { user };
  });

  router.on('POST', '/api/auth/logout', ({ req, res }) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) auth.endSession(token);
    res.setHeader('Set-Cookie', sessionCookie(req, null));
    return { ok: true };
  });

  // { user: null } when signed out: "not signed in" is a normal answer here, not an error.
  router.on('GET', '/api/auth/me', ({ req }) => ({ user: auth.userForToken(readCookie(req, SESSION_COOKIE)) }));

  router.on('POST', '/api/auth/password', async ({ req, res }) => {
    const user = current(req);
    const b = await body(req);
    if (!auth.login(user.username, typeof b.current === 'string' ? b.current : '')) throw new HttpError(400, 'Текущий пароль неверен');
    auth.setPassword(user.id, checkNewPassword(b.next)); // also ends all sessions
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(user.id)));
    return { ok: true };
  });

  // What the invitation link is for (shown before the user fills in the form).
  router.on('GET', '/api/auth/invite/:token', ({ params }) => {
    const inv = auth.invite(params.token);
    if (!inv) throw new HttpError(404, 'Ссылка недействительна или уже использована');
    return { kind: inv.kind, username: inv.username ?? null, workspaceName: inv.workspaceName ?? null, role: inv.role ?? null };
  });

  // Accepts an invitation: creates the account (or sets a new password) and signs in.
  router.on('POST', '/api/auth/invite/:token', async ({ req, res, params }) => {
    const inv = auth.invite(params.token);
    if (!inv) throw new HttpError(404, 'Ссылка недействительна или уже использована');
    const b = await body(req);
    const password = checkNewPassword(b.password);
    const userId = transaction(db, () => {
      let id = inv.userId;
      if (inv.kind === 'account') {
        const displayName = typeof b.displayName === 'string' && b.displayName.trim() ? b.displayName.trim().slice(0, 80) : null;
        id = auth.createUser(checkUsername(b.username), displayName, password, Boolean(inv.isAdmin));
        if (inv.workspaceId) auth.addMember(inv.workspaceId, id, inv.role ?? 'viewer');
      } else {
        auth.setPassword(id, password);
      }
      auth.useInvite(params.token);
      return /** @type {number} */ (id);
    });
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(userId)));
    return { user: auth.userById(userId) };
  });
}
