// @ts-check
// Analytics: the app's minute of activity (every signed-in person) and the reports (administrators).
import { HttpError, readJson } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../analytics.js').createAnalytics>} analytics
 */
export function registerAnalyticsRoutes(router, analytics) {
  // { section, reading, listening } — once a minute while the person is active
  router.on('POST', '/api/activity', async ({ req, user }) => {
    analytics.beat(user.id, /** @type {any} */ ((await readJson(req)) ?? {}));
    return { ok: true };
  });

  // ?days=7|30|90|… (0 — all time)
  router.on('GET', '/api/admin/analytics', ({ url, user }) => {
    if (!user.isAdmin) throw new HttpError(403, 'Аналитику видит администратор');
    return analytics.report(Number(url.searchParams.get('days') ?? 30));
  });
}
