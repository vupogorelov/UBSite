// @ts-check
// Integrations (administrators): the English text's source — its settings, "sync now", the reports.
import { HttpError, readJson } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../textsync.js').createTextSync>} textSync
 */
export function registerIntegrationRoutes(router, textSync) {
  /** @param {import('../auth.js').User} user */
  const requireAdmin = (user) => {
    if (!user.isAdmin) throw new HttpError(403, 'Интеграциями управляет администратор');
  };

  router.on('GET', '/api/integrations/en', ({ user }) => (requireAdmin(user), { config: textSync.config(), runs: textSync.runs() }));
  // { enabled?, intervalHours?, url? }
  router.on('PUT', '/api/integrations/en', async ({ req, user }) => {
    requireAdmin(user);
    return textSync.setConfig(/** @type {any} */ ((await readJson(req)) ?? {}));
  });
  router.on('POST', '/api/integrations/en/run', async ({ user }) => {
    requireAdmin(user);
    return textSync.run('manual');
  });
}
