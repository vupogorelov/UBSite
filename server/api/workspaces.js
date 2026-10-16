// @ts-check
// Workspaces: membership and roles, settings (personal + shared), saved queries (shared), search history (personal).
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import { ROLES, roleRank, publicOrigin } from '../auth.js';
import { sanitizeSettings, settingDefaults } from '../../shared/settings.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 */
export function registerWorkspaceRoutes(router, db, auth) {
  const q = {
    mine: db.prepare(
      `SELECT w.id, w.name, w.kind, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY w.kind = 'group', w.name COLLATE NOCASE`,
    ),
    get: db.prepare('SELECT id, name, kind, settings FROM workspaces WHERE id = ?'),
    create: db.prepare("INSERT INTO workspaces (name, kind) VALUES (?, 'group') RETURNING id"),
    rename: db.prepare('UPDATE workspaces SET name = ? WHERE id = ?'),
    remove: db.prepare("DELETE FROM workspaces WHERE id = ? AND kind = 'group'"),
    saveShared: db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?'),
    personal: db.prepare('SELECT settings FROM user_settings WHERE user_id = ? AND workspace_id = ?'),
    savePersonal: db.prepare(
      `INSERT INTO user_settings (user_id, workspace_id, settings) VALUES (?, ?, ?)
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET settings = excluded.settings`,
    ),
    // whom the owner can add: active people of the platform not in the workspace yet (not the Book's voice)
    candidates: db.prepare(
      `SELECT u.username, coalesce(u.display_name, u.username) AS name FROM users u
       WHERE u.disabled = 0 AND u.is_agent = 0
         AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ? AND m.user_id = u.id)
       ORDER BY coalesce(u.display_name, u.username) COLLATE NOCASE`,
    ),
    members: db.prepare(
      `SELECT u.id AS userId, u.username, u.display_name AS displayName, m.role, m.joined_at AS joinedAt
       FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.username_key`,
    ),
    owners: db.prepare("SELECT count(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = 'owner'"),
    userByName: db.prepare('SELECT id FROM users WHERE username_key = ? AND disabled = 0'),
    setRole: db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?'),
    removeMember: db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?'),
  };

  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
  /** @param {unknown} v */
  const checkName = (v) => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > 80) throw new HttpError(400, 'Название: от 1 до 80 символов');
    return v.trim();
  };
  /** @param {unknown} v @returns {import('../auth.js').Role} */
  const checkRole = (v) => {
    if (typeof v !== 'string' || !ROLES.includes(/** @type {any} */ (v))) throw new HttpError(400, 'Роль: owner, editor, commenter или viewer');
    return /** @type {import('../auth.js').Role} */ (v);
  };
  /** @param {number} ws */
  const workspace = (ws) => /** @type {{ id: number, name: string, kind: string, settings: string }} */ (q.get.get(ws));

  /** Shared settings of the workspace + this user's personal ones, over the defaults. @param {number} ws @param {number} userId */
  const resolvedSettings = (ws, userId) => {
    const shared = sanitizeSettings(JSON.parse(workspace(ws).settings), 'workspace');
    const row = /** @type {{ settings: string } | undefined} */ (q.personal.get(userId, ws));
    const personal = sanitizeSettings(JSON.parse(row?.settings ?? '{}'), 'user');
    return { ...settingDefaults(), ...shared, ...personal };
  };

  router.on('GET', '/api/workspaces', ({ user }) => q.mine.all(user.id));

  router.on('POST', '/api/workspaces', async ({ req, user }) => {
    const name = checkName((await body(req)).name);
    const id = transaction(db, () => {
      const row = /** @type {{ id: number }} */ (q.create.get(name));
      auth.addMember(row.id, user.id, 'owner');
      return row.id;
    });
    return { id, name, kind: 'group', role: 'owner' };
  });

  router.on('GET', '/api/workspaces/:id', ({ params, user }) => {
    const ws = Number(params.id);
    const role = auth.require(ws, user, 'viewer');
    const w = workspace(ws);
    return { id: w.id, name: w.name, kind: w.kind, role, settings: resolvedSettings(ws, user.id) };
  });

  router.on('PATCH', '/api/workspaces/:id', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    q.rename.run(checkName((await body(req)).name), ws);
    return { ok: true };
  });

  router.on('DELETE', '/api/workspaces/:id', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    if (workspace(ws).kind !== 'group') throw new HttpError(400, 'Личное пространство удалить нельзя');
    q.remove.run(ws);
    return { ok: true };
  });

  // Partial update. Personal keys always; shared keys (color names) need editor rights.
  router.on('PUT', '/api/workspaces/:id/settings', async ({ req, params, user }) => {
    const ws = Number(params.id);
    const role = auth.require(ws, user, 'viewer');
    const b = await body(req);
    const sharedPatch = sanitizeSettings(b, 'workspace');
    const personalPatch = sanitizeSettings(b, 'user');
    transaction(db, () => {
      if (Object.keys(sharedPatch).length) {
        if (roleRank(role) < roleRank('editor')) throw new HttpError(403, 'Общие настройки пространства меняют редакторы и владельцы');
        const cur = sanitizeSettings(JSON.parse(workspace(ws).settings), 'workspace');
        q.saveShared.run(JSON.stringify({ ...cur, ...sharedPatch }), ws);
      }
      if (Object.keys(personalPatch).length) {
        const row = /** @type {{ settings: string } | undefined} */ (q.personal.get(user.id, ws));
        const cur = sanitizeSettings(JSON.parse(row?.settings ?? '{}'), 'user');
        q.savePersonal.run(user.id, ws, JSON.stringify({ ...cur, ...personalPatch }));
      }
    });
    return resolvedSettings(ws, user.id);
  });

  // ---- Members ----
  router.on('GET', '/api/workspaces/:id/members', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'viewer');
    return q.members.all(ws);
  });

  /** @param {number} ws */
  const requireGroup = (ws) => {
    if (workspace(ws).kind !== 'group') throw new HttpError(400, 'В личное пространство нельзя добавлять участников');
  };

  // People of the platform the owner may add (they are chosen from a list, not typed)
  router.on('GET', '/api/workspaces/:id/candidates', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    requireGroup(ws);
    return q.candidates.all(ws);
  });

  // Adds an existing user: { username, role }
  router.on('POST', '/api/workspaces/:id/members', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    requireGroup(ws);
    const b = await body(req);
    const target = /** @type {{ id: number } | undefined} */ (q.userByName.get(String(b.username ?? '').trim().toLowerCase()));
    if (!target) throw new HttpError(404, `Пользователь «${b.username}» не найден`);
    auth.addMember(ws, target.id, checkRole(b.role));
    return q.members.all(ws);
  });

  // Link that creates an account and joins this workspace: { role }
  router.on('POST', '/api/workspaces/:id/invites', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    requireGroup(ws);
    const role = checkRole((await body(req)).role);
    const token = auth.createInvite({ kind: 'account', workspaceId: ws, role, createdBy: user.id });
    return { url: `${publicOrigin(req)}/invite/${token}` };
  });

  /** The last owner can be neither demoted nor removed. @param {number} ws @param {number} userId */
  const keepAnOwner = (ws, userId) => {
    if (auth.role(ws, userId) === 'owner' && /** @type {{ n: number }} */ (q.owners.get(ws)).n <= 1) {
      throw new HttpError(400, 'В пространстве должен остаться хотя бы один владелец');
    }
  };

  router.on('PATCH', '/api/workspaces/:id/members/:uid', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    const uid = Number(params.uid);
    const role = checkRole((await body(req)).role);
    if (role !== 'owner') keepAnOwner(ws, uid);
    q.setRole.run(role, ws, uid);
    return q.members.all(ws);
  });

  // Owners remove anyone; every member may leave.
  router.on('DELETE', '/api/workspaces/:id/members/:uid', ({ params, user }) => {
    const ws = Number(params.id);
    const uid = Number(params.uid);
    auth.require(ws, user, uid === user.id ? 'viewer' : 'owner');
    requireGroup(ws);
    keepAnOwner(ws, uid);
    q.removeMember.run(ws, uid);
    return { ok: true };
  });

  // ---- Saved search queries (shared) and history (personal) ----
  const sq = {
    saved: db.prepare(
      `SELECT id, title, query, created_at AS createdAt, updated_at AS updatedAt
       FROM saved_queries WHERE workspace_id = ? ORDER BY title COLLATE NOCASE`,
    ),
    recent: db.prepare(
      'SELECT query, used_at AS usedAt, uses FROM search_history WHERE workspace_id = ? AND user_id = ? ORDER BY used_at DESC LIMIT 30',
    ),
    insert: db.prepare('INSERT INTO saved_queries (workspace_id, title, query) VALUES (?, ?, ?) RETURNING id, title, query'),
    update: db.prepare(
      `UPDATE saved_queries SET title = ?, query = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ? RETURNING id, title, query`,
    ),
    get: db.prepare('SELECT title, query FROM saved_queries WHERE id = ? AND workspace_id = ?'),
    remove: db.prepare('DELETE FROM saved_queries WHERE id = ? AND workspace_id = ?'),
    touch: db.prepare(
      `INSERT INTO search_history (workspace_id, user_id, query) VALUES (?, ?, ?)
       ON CONFLICT (workspace_id, user_id, query) DO UPDATE SET used_at = datetime('now'), uses = uses + 1`,
    ),
    trim: db.prepare(
      `DELETE FROM search_history WHERE workspace_id = :ws AND user_id = :user AND query NOT IN
       (SELECT query FROM search_history WHERE workspace_id = :ws AND user_id = :user ORDER BY used_at DESC LIMIT 200)`,
    ),
    clear: db.prepare('DELETE FROM search_history WHERE workspace_id = ? AND user_id = ?'),
  };

  /** @param {unknown} v @param {string} name @param {number} max */
  const text = (v, name, max) => {
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `Поле «${name}» не заполнено`);
    if (v.length > max) throw new HttpError(400, `Поле «${name}» длиннее ${max} символов`);
    return v.trim();
  };

  router.on('GET', '/api/workspaces/:id/queries', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'viewer');
    return { saved: sq.saved.all(ws), recent: sq.recent.all(ws, user.id) };
  });

  router.on('POST', '/api/workspaces/:id/queries', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'editor');
    const b = await body(req);
    return sq.insert.get(ws, text(b.title, 'название', 200), text(b.query, 'запрос', 5000));
  });

  router.on('PUT', '/api/workspaces/:id/queries/:qid', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'editor');
    const current = /** @type {{ title: string, query: string } | undefined} */ (sq.get.get(Number(params.qid), ws));
    if (!current) throw new HttpError(404, 'Запрос не найден');
    const b = await body(req);
    const title = b.title === undefined ? current.title : text(b.title, 'название', 200);
    const query = b.query === undefined ? current.query : text(b.query, 'запрос', 5000);
    return sq.update.get(title, query, Number(params.qid), ws);
  });

  router.on('DELETE', '/api/workspaces/:id/queries/:qid', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'editor');
    sq.remove.run(Number(params.qid), ws);
    return { ok: true };
  });

  router.on('POST', '/api/workspaces/:id/history', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'viewer');
    sq.touch.run(ws, user.id, text((await body(req)).query, 'запрос', 5000));
    sq.trim.run({ ws, user: user.id });
    return { ok: true };
  });

  router.on('DELETE', '/api/workspaces/:id/history', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'viewer');
    sq.clear.run(ws, user.id);
    return { ok: true };
  });
}
