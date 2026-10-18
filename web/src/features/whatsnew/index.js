// @ts-check
// «Что нового» in the app: its page (/whatsnew); the bell offers the newest entry not seen
// (NotificationsMenu), «О приложении» leads to it; the server's side: server/features/whatsnew.js.

/** @type {import('../../lib/pages.js').Page} */
export const page = {
  id: 'whatsnew', path: '/whatsnew', match: (p) => p === '/whatsnew', title: 'Что нового', kind: 'page',
  load: () => import('./WhatsNewPage.svelte'),
};
