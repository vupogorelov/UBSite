// @ts-check
import { api } from './api.js';
import { navigate, parsePath } from './router.svelte.js';
import { settings } from './settings.svelte.js';
import { aliases } from './aliases.svelte.js';
import { unalias } from '../../../shared/aliases.js';

/** @typedef {import('./api.js').SearchResult} SearchResult */

export const search = $state({
  /** Text in the search box. */
  input: '',
  /** The query whose results are shown ('' = no active search). */
  query: '',
  total: 0,
  /** @type {Record<string, number>} part id → matches */
  facets: {},
  /** @type {SearchResult[]} */
  results: [],
  /** @type {string[]} every matching ref in book order */
  refs: [],
  loading: false,
  error: '',
});

export const library = $state({
  /** @type {import('./api.js').SavedQuery[]} */ saved: [],
  /** @type {import('./api.js').RecentQuery[]} */ recent: [],
});

let token = 0;

/** @param {string} text @param {{ record?: boolean }} [opts] */
export async function runSearch(text, opts = {}) {
  const q = text.trim();
  search.input = q;
  if (!q) return clearSearch();
  const my = ++token;
  search.loading = true;
  try {
    // "Названия по смыслу": a query for "Спасоград" looks for "Салвингтон", as the text has it
    const d = await api.search(settings.altNames && aliases.list.length ? unalias(q, aliases.list) : q, 0);
    if (my !== token) return;
    Object.assign(search, { query: q, total: d.total, facets: d.facets, results: d.results, refs: d.refs ?? [], error: '' });
    if (opts.record !== false) api.addHistory(q).then(loadLibrary, () => {});
  } catch (err) {
    if (my !== token) return;
    Object.assign(search, { query: '', total: 0, facets: {}, results: [], refs: [], error: /** @type {Error} */ (err).message });
  } finally {
    if (my === token) search.loading = false;
  }
}

export async function loadMore() {
  if (search.loading || !search.query || search.results.length >= search.total) return;
  const my = token;
  search.loading = true;
  try {
    const d = await api.search(search.query, search.results.length);
    if (my === token) search.results.push(...d.results);
  } finally {
    if (my === token) search.loading = false;
  }
}

export function clearSearch() {
  token++;
  Object.assign(search, { input: '', query: '', total: 0, facets: {}, results: [], refs: [], loading: false, error: '' });
}

/**
 * Adds, replaces or (value = null) removes a filter such as "часть:2" in the query text.
 * @param {string} q @param {string} key @param {string | null} value
 */
export function withFilter(q, key, value) {
  const aliases = { часть: 'part', текст: 'paper', раздел: 'section', язык: 'lang' };
  const names = [key, /** @type {Record<string, string>} */ (aliases)[key]].filter(Boolean).join('|');
  const stripped = q.replace(new RegExp(`(^|\\s)(?:${names}):\\S+`, 'giu'), '').trim();
  return value === null ? stripped : `${stripped} ${key}:${value}`.trim();
}

/** Current filter value in the query text, e.g. "2" for "часть:2". @param {string} q @param {string} key */
export function filterValue(q, key) {
  return q.match(new RegExp(`(?:^|\\s)${key}:(\\S+)`, 'iu'))?.[1] ?? null;
}

// ---- Navigation between hits in the reader ----

/** @param {string} ref @returns {[number, number, number]} */
const refKey = (ref) => /** @type {[number, number, number]} */ (ref.split(/[:.]/).map(Number));
/** @param {number[]} a @param {number[]} b */
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Reading position from the address bar (kept current while scrolling). */
function position() {
  const t = parsePath(location.pathname);
  if (t.ref) return refKey(t.ref);
  return [t.paper ?? 0, t.section ?? 0, 0];
}

/** Index of the hit the reader is on, or -1. */
export function currentHit() {
  const ref = parsePath(location.pathname).ref;
  return ref ? search.refs.indexOf(ref) : -1;
}

/** @param {1 | -1} dir */
export function stepHit(dir) {
  if (!search.refs.length) return;
  const pos = position();
  let i;
  if (dir > 0) {
    i = search.refs.findIndex((r) => cmp(refKey(r), pos) > 0);
    if (i === -1) i = 0; // wrap around
  } else {
    i = search.refs.findLastIndex((r) => cmp(refKey(r), pos) < 0);
    if (i === -1) i = search.refs.length - 1;
  }
  navigate(`/${search.refs[i]}`);
}

// ---- Saved queries and history ----

export async function loadLibrary() {
  try {
    Object.assign(library, await api.queries());
  } catch (err) {
    console.error('Saved queries not loaded:', err);
  }
}

/** @param {string} title @param {string} query */
export async function saveQuery(title, query) {
  await api.saveQuery(title, query);
  await loadLibrary();
}

/** @param {number} id @param {{ title?: string, query?: string }} patch */
export async function updateQuery(id, patch) {
  await api.updateQuery(id, patch);
  await loadLibrary();
}

/** @param {number} id */
export async function deleteQuery(id) {
  await api.deleteQuery(id);
  await loadLibrary();
}

export async function clearHistory() {
  await api.clearHistory();
  await loadLibrary();
}
