// @ts-check
// The dictionary of the book in the app: its pages (lib/pages.js), its place in the navigation
// (lib/sections.svelte.js), «Что это?» among the text actions (lib/text-actions.js). Its card is shown
// over everything (App.svelte); «Что это?» is in actions.js (it reaches the app's state: kept out of this
// plain description, which the registries read); the server's side: server/features/dictionary/.

/** @type {import('../../lib/pages.js').Page[]} */
export const pages = [
  {
    id: 'dictionary', path: '/d', title: 'Словарь', kind: 'page',
    match: (p) => p === '/d' || p.startsWith('/d?'),
    load: () => import('./DictionaryPage.svelte'),
    guest: true,
  },
  {
    // /d/12 — an article; shared by its address like a paragraph (a guest reads it too)
    id: 'article', title: 'Словарь', kind: 'page',
    match: (p) => /^\/d\/\d+\/?(\?.*)?$/.test(p),
    load: () => import('./ArticlePage.svelte'),
    props: (p) => ({ id: Number(p.split('?')[0].split('/')[2]) }),
    guest: true,
  },
];

/** In the navigation: with the apps; on a phone in «Ещё». @type {import('../../lib/sections.svelte.js').Section} */
export const section = { id: 'dictionary', label: 'Словарь', icon: 'dictionary', group: 'apps', phone: 'more', path: '/d' };
