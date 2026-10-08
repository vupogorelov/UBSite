// @ts-check
// In-app notifications (the bell) and the counters polled by the app.

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../translation.js').createTranslation>} tr
 * @param {ReturnType<typeof import('../notifications.js').createNotifications>} notifications
 */
export function registerNotificationRoutes(router, tr, notifications) {
  // { unread, queue } — cheap enough to poll.
  router.on('GET', '/api/notifications/count', ({ user }) => {
    tr.sweep();
    return notifications.counts(user);
  });

  router.on('GET', '/api/notifications', ({ user }) => {
    tr.sweep();
    return { items: notifications.list(user), ...notifications.counts(user) };
  });

  // The list was opened: everything in it is read.
  router.on('POST', '/api/notifications/seen', ({ user }) => {
    notifications.markSeen(user);
    return notifications.counts(user);
  });
}
