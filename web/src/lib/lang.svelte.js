// @ts-check
// The book's languages for the reader (VISION.md, principle 8: a language is data): the main one — the
// text one reads ("Язык чтения"), and the comparison under it, if any (now: the English original under
// the Russian; reading in English there is none). Places that show the book ask here instead of
// writing `ru` / `en` themselves, so further languages come without rewriting them.
import { settings } from './settings.svelte.js';

/** @typedef {'ru' | 'en'} Lang */

export const book = {
  /** @returns {Lang} */
  get main() {
    return settings.readLang === 'en' ? 'en' : 'ru';
  },
  /** The comparison block's language (null — none). @returns {Lang | null} */
  get compare() {
    return this.main === 'ru' && settings.enMode !== 'hidden' ? 'en' : null;
  },
  /** How the comparison shows: 'full' | 'collapsed' | 'hidden'. */
  get compareMode() {
    return this.main === 'ru' ? settings.enMode : 'hidden';
  },
};

/** A text in a language from `{ ru, en }`. @param {{ ru: string, en: string }} o @param {Lang} lang */
export const inLang = (o, lang) => (lang === 'en' ? o.en : o.ru);

/** A title in a language from `{ titleRu, titleEn }` (the Russian if there is no other). @param {{ titleRu: string, titleEn?: string | null }} o @param {Lang} lang */
export const titleIn = (o, lang) => (lang === 'en' ? o.titleEn || o.titleRu : o.titleRu);
