// @ts-check
// The app's sections in one list. On the desktop all of them are buttons of the ribbon (the icon
// column at the left edge, as in Obsidian); on the phone each has its place: the bottom navigation,
// the chips of the notes screen, or the "Ещё" sheet. A new section = a new item here.
import { notify } from './notify.svelte.js';
import { search } from './search.svelte.js';

/**
 * `tab`: a tab of the sidebar next to the book; `path`: a page of its own in place of the book.
 * `phone`: where the phone shows it. `badge`: a counter on the button (0 = none).
 * @typedef {{
 *   id: string, label: string, icon: string, group: 'book' | 'apps' | 'meta',
 *   phone: 'nav' | 'notes' | 'more',
 *   badge?: () => number,
 *   tab?: import('./ui.svelte.js').Tab, path?: string,
 * }} Section
 */

/** @type {Section[]} */
export const SECTIONS = [
  { id: 'toc', label: 'Оглавление', icon: 'toc', group: 'book', phone: 'nav', tab: 'toc' },
  { id: 'search', label: 'Поиск', icon: 'search', group: 'book', phone: 'nav', tab: 'search', badge: () => (search.query ? search.total : 0) },
  { id: 'notes', label: 'Заметки', icon: 'notes', group: 'book', phone: 'nav', tab: 'notes' },
  { id: 'collections', label: 'Подборки', icon: 'layers', group: 'book', phone: 'notes', tab: 'collections' },
  { id: 'tags', label: 'Теги', icon: 'tag', group: 'book', phone: 'notes', tab: 'tags' },
  { id: 'translate', label: 'Перевод', icon: 'translate', group: 'book', phone: 'more', tab: 'translate', badge: () => notify.queue },
  { id: 'chat', label: 'Чат', icon: 'discuss', group: 'apps', phone: 'nav', path: '/chat', badge: () => notify.chatUnread },
  { id: 'tasks', label: 'Мои задачи', icon: 'check-square', group: 'apps', phone: 'more', path: '/tasks' },
  { id: 'about', label: 'О приложении', icon: 'info', group: 'meta', phone: 'more', path: '/about' },
];

/** Counter text for a badge. @param {number} n */
export const badgeText = (n) => (n > 999 ? '999+' : String(n));
