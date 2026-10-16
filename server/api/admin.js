// @ts-check
// Administration: accounts and their invitation / password reset links. Admins only.
import { HttpError, readJson } from '../http.js';
import { publicOrigin } from '../auth.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 * @param {ReturnType<typeof import('../translation.js').createTranslation>} tr
 */
export function registerAdminRoutes(router, db, auth, tr) {
  const q = {
    users: db.prepare(
      `SELECT id, username, display_name AS displayName, is_admin AS isAdmin, is_translator AS isTranslator,
              is_coordinator AS isCoordinator, disabled, created_at AS createdAt, password_hash IS NOT NULL AS hasPassword,
              email, email_verified AS emailVerified
       FROM users ORDER BY username_key`,
    ),
    setDisabled: db.prepare('UPDATE users SET disabled = ? WHERE id = ?'),
    setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
    setTranslator: db.prepare('UPDATE users SET is_translator = ? WHERE id = ?'),
    setCoordinator: db.prepare('UPDATE users SET is_coordinator = ? WHERE id = ?'),
    admins: db.prepare('SELECT count(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0'),
  };

  /** @param {import('../auth.js').User} user */
  const requireAdmin = (user) => {
    if (!user.isAdmin) throw new HttpError(403, 'Только для администратора');
  };

  router.on('GET', '/api/admin/users', ({ user }) => {
    requireAdmin(user);
    return /** @type {any[]} */ (q.users.all()).map((u) => ({
      ...u,
      isAdmin: Boolean(u.isAdmin),
      isTranslator: Boolean(u.isTranslator),
      isCoordinator: Boolean(u.isCoordinator),
      disabled: Boolean(u.disabled),
      hasPassword: Boolean(u.hasPassword),
      emailVerified: Boolean(u.emailVerified),
    }));
  });

  // Voting rule of the translation layer.
  router.on('GET', '/api/admin/voting', ({ user }) => {
    requireAdmin(user);
    return tr.config();
  });
  router.on('PUT', '/api/admin/voting', async ({ req, user }) => {
    requireAdmin(user);
    return tr.setConfig(await readJson(req));
  });

  // Open sign-up on the login page: { open }
  router.on('PUT', '/api/admin/registration', async ({ req, user }) => {
    requireAdmin(user);
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    if (typeof b.open !== 'boolean') throw new HttpError(400, 'Нужно open: true или false');
    return { open: auth.setRegistrationOpen(b.open) };
  });

  // Link for a new account: { isAdmin? }
  router.on('POST', '/api/admin/invites', async ({ req, user }) => {
    requireAdmin(user);
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const token = auth.createInvite({ kind: 'account', isAdmin: b.isAdmin === true, createdBy: user.id });
    return { url: `${publicOrigin(req)}/invite/${token}` };
  });

  router.on('POST', '/api/admin/users/:uid/reset', ({ req, params, user }) => {
    requireAdmin(user);
    const target = auth.userById(Number(params.uid));
    if (!target) throw new HttpError(404, 'Пользователь не найден');
    const token = auth.createInvite({ kind: 'reset', userId: target.id, createdBy: user.id });
    return { url: `${publicOrigin(req)}/invite/${token}` };
  });

  // { disabled?, isAdmin?, isTranslator?, isCoordinator? }
  router.on('PATCH', '/api/admin/users/:uid', async ({ req, params, user }) => {
    requireAdmin(user);
    const target = auth.userById(Number(params.uid));
    if (!target) throw new HttpError(404, 'Пользователь не найден');
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const losesAdmin = (b.disabled === true && target.isAdmin) || (b.isAdmin === false && target.isAdmin);
    if (losesAdmin && /** @type {{ n: number }} */ (q.admins.get()).n <= 1) {
      throw new HttpError(400, 'Нельзя отключить последнего администратора');
    }
    if (typeof b.disabled === 'boolean') {
      q.setDisabled.run(b.disabled ? 1 : 0, target.id);
      if (b.disabled) auth.endAllSessions(target.id);
    }
    if (typeof b.isAdmin === 'boolean') q.setAdmin.run(b.isAdmin ? 1 : 0, target.id);
    if (typeof b.isTranslator === 'boolean') q.setTranslator.run(b.isTranslator ? 1 : 0, target.id);
    if (typeof b.isCoordinator === 'boolean') q.setCoordinator.run(b.isCoordinator ? 1 : 0, target.id);
    return auth.userById(target.id);
  });
}
