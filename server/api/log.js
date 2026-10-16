// @ts-check
// The devices' journal: every signed-in device sends its events; administrators read them.
import { HttpError, readJson } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../clientlog.js').createClientLog>} log
 */
export function registerLogRoutes(router, log) {
  // { session, device, events: [{ at, level, kind, name, data? }] }
  router.on('POST', '/api/log', async ({ req, user }) => ({ kept: log.add(user.id, /** @type {any} */ ((await readJson(req, 512_000)) ?? {})) }));

  // ?user=<id>&failed=1&before=<time> — sessions, newest first, with their events
  router.on('GET', '/api/admin/log', ({ url, user }) => {
    if (!user.isAdmin) throw new HttpError(403, 'Журнал видит администратор');
    const u = url.searchParams.get('user');
    return log.list({ user: u ? Number(u) : null, failed: url.searchParams.get('failed') === '1', before: url.searchParams.get('before') });
  });
}
