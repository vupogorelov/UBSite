// @ts-check
// The pages shown in place of the book, in one list: the shell (Shell.svelte) shows the page of the
// address, titles its header from here and loads its component when first opened; the router treats a
// page's own address as a section (lib/router.svelte.js: "back" from it goes to the book). A new page =
// a new item here (and, if it is a section of the navigation, an item in lib/sections.svelte.js). A feature
// in a folder of its own (web/src/features/<name>/) gives its page from its index.js.
//
// kind: 'page' — it covers the book and its sidebar (the phone: a section's screen with ← and a title);
//       'collection' — read in place of the book, the sidebar stays.

/**
 * @typedef {{
 *   id: string,
 *   path?: string,
 *   match: (path: string) => boolean,
 *   title: string,
 *   phoneTitle?: string,
 *   kind: 'page' | 'collection',
 *   load: () => Promise<{ default: any }>,
 *   props?: (path: string) => Record<string, unknown>,
 *   sectionHead?: (path: string) => boolean,
 *   guest?: boolean,
 * }} Page
 * `path`: the page's own address (a section of the navigation); `phoneTitle`: the phone's header, when
 * shorter; `props`: what the component is given, from the address; `sectionHead`: whether the phone shows
 * the section's header (a chat's conversation has its own); `guest`: read without signing in too (a shared link).
 */

import { page as supportPage } from '../features/support/index.js';
import { pages as dictionaryPages } from '../features/dictionary/index.js';

/** "/x" or "/x?…". @param {string} base */
const at = (base) => (/** @type {string} */ path) => path === base || path.startsWith(`${base}?`);

/** @type {Page[]} */
export const PAGES = [
  {
    id: 'chat', path: '/chat', match: at('/chat'), title: 'Чат', kind: 'page',
    load: () => import('../components/ChatPage.svelte'),
    sectionHead: (path) => !path.includes('c='), // (an open conversation has its own header)
  },
  { id: 'tasks', path: '/tasks', match: at('/tasks'), title: 'Мои задачи', phoneTitle: 'Задачи', kind: 'page', load: () => import('../components/TasksPage.svelte') },
  { id: 'about', path: '/about', match: (p) => p === '/about', title: 'О приложении', kind: 'page', load: () => import('../components/AboutPage.svelte') },
  supportPage, // (a feature in a folder of its own: web/src/features/support/)
  ...dictionaryPages, // (web/src/features/dictionary/)
  {
    // /c/12 — a collection read in place of the book
    id: 'collection', match: (p) => /^\/c\/\d+\/?$/.test(p), title: 'Подборка', kind: 'collection',
    load: () => import('../components/CollectionReader.svelte'),
    props: (path) => ({ id: Number(path.split('/')[2]) }),
  },
];

/** The page of an address (null — the book). @param {string} path */
export const pageOf = (path) => PAGES.find((p) => p.match(path)) ?? null;

/** A page's own address: a section (the router: "back" from it goes to the book). @param {string} path */
export const isSectionPath = (path) => PAGES.some((p) => p.kind === 'page' && p.path === path);
