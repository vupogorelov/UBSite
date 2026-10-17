// @ts-check
// The Laboratory in the app: an administrator's page (/lab) and its button in the ribbon, shown to an
// administrator alone (plain data: the registries read it in tests too); the server's side: server/features/lab/.

/** @type {import('../../lib/pages.js').Page} */
export const page = {
  id: 'lab', path: '/lab', match: (p) => p === '/lab' || p.startsWith('/lab?'), title: 'Лаборатория', kind: 'page',
  load: () => import('./LabPage.svelte'),
};

/** @type {import('../../lib/sections.svelte.js').Section} */
export const section = { id: 'lab', label: 'Лаборатория', icon: 'flask', group: 'apps', phone: 'more', path: '/lab', admin: true };
