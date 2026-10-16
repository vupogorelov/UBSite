// @ts-check
// «Поддержать проект»: a few words and the YooMoney fundraising widget. The page is listed in
// lib/pages.js from here; the server lets the widget's site in (server/features/support.js).

/** @type {import('../../lib/pages.js').Page} */
export const page = {
  id: 'support',
  path: '/support',
  match: (p) => p === '/support',
  title: 'Поддержать проект',
  kind: 'page',
  load: () => import('./SupportPage.svelte'),
};
