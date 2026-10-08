// @ts-check
// Sidebar state shared by components that need to open a tab (e.g. a click on a #tag).
import { tags, tagKey } from './tags.svelte.js';

const TAB_KEY = 'ub.sidebarTab';
const TABS = /** @type {const} */ (['toc', 'search', 'notes', 'tags', 'collections', 'translate', 'voice']);
/** @typedef {(typeof TABS)[number]} Tab */

function readTab() {
  try {
    const t = /** @type {Tab} */ (localStorage.getItem(TAB_KEY));
    return TABS.includes(t) ? t : 'toc';
  } catch {
    return 'toc';
  }
}

export const NARROW = 900;

export const ui = $state({
  /** @type {Tab} */ tab: readTab(),
  sidebarOpen: innerWidth > NARROW,
  /** List shown in the translation tab. @type {'queue' | 'voting' | 'mine' | 'approved' | 'glossary' | 'summary'} */
  trScope: 'queue',
});

/** @param {Tab} tab */
export function setTab(tab) {
  ui.tab = tab;
  ui.sidebarOpen = true;
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {}
}

/** Opens the notes tab with the tag as the selected folder. @param {string} name */
export function showNotesForTag(name) {
  tags.filter = tagKey(name.replace(/^#/, ''));
  setTab('notes');
}
