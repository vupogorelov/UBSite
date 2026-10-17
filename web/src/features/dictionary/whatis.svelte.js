// @ts-check
// «Что это?»: the article of the selected words, in a card over the text (WhatIsCard.svelte).
import { dictApi } from './api.js';

export const whatIs = $state({
  open: false,
  loading: false,
  /** The selected words. */
  text: '',
  /** @type {import('./api.js').Found | null} */
  found: null,
  error: '',
});

/** @param {string} text the selected words @param {'ru' | 'en'} lang */
export async function openWhatIs(text, lang) {
  Object.assign(whatIs, { open: true, loading: true, text: text.trim(), found: null, error: '' });
  try {
    const found = await dictApi.lookup(whatIs.text, lang);
    if (whatIs.text === text.trim()) whatIs.found = found;
  } catch (err) {
    whatIs.error = /** @type {Error} */ (err).message;
  } finally {
    whatIs.loading = false;
  }
}

export function closeWhatIs() {
  whatIs.open = false;
}
