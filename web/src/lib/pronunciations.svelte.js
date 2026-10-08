// @ts-check
// The shared pronunciation dictionary on the client: loaded once, applied to every sentence read aloud.
import { api } from './api.js';
import { compile, pronounce } from './pronounce.js';
import { showToast } from './toast.svelte.js';

export const dict = $state({
  /** @type {import('./api.js').Pronunciation[]} */
  list: [],
  loaded: false,
});

/** Compiled rules per language (rebuilt when the list changes). */
let compiled = { ru: compile([]), en: compile([]) };
function rebuild() {
  compiled = {
    ru: compile(dict.list.filter((p) => p.lang === 'ru')),
    en: compile(dict.list.filter((p) => p.lang === 'en')),
  };
}

let loading = /** @type {Promise<void> | null} */ (null);
/** @param {boolean} [force] */
export function loadDict(force = false) {
  if ((dict.loaded || loading) && !force) return loading ?? Promise.resolve();
  loading = api.pronunciations().then(
    (list) => {
      dict.list = list;
      dict.loaded = true;
      rebuild();
      loading = null;
    },
    () => {
      loading = null;
    },
  );
  return loading;
}

/** A sentence as the voice should say it. @param {string} text @param {'ru' | 'en'} lang */
export const applyDict = (text, lang) => pronounce(text, compiled[lang]);

/** @param {() => Promise<unknown>} fn */
async function change(fn) {
  try {
    await fn();
    await loadDict(true);
    return true;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
    return false;
  }
}
/** @param {Omit<import('./api.js').Pronunciation, 'id'>} p */
export const addRule = (p) => change(() => api.createPronunciation(p));
/** @param {number} id @param {Omit<import('./api.js').Pronunciation, 'id'>} p */
export const updateRule = (id, p) => change(() => api.updatePronunciation(id, p));
/** @param {number} id */
export const deleteRule = (id) => change(() => api.deletePronunciation(id));
