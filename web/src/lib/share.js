// @ts-check
// Public links to a place in the book: a paragraph "/5:1.3", or a quote in it "/5:1.3?sel=ru.120-184"
// (the language and the quote's character offsets in the paragraph's text, as notes keep them).
// Anyone opens them — signed in or not (a guest reads the paper; server/main.js GUEST).
import { showToast } from './toast.svelte.js';
import { writeText } from './clipboard.js';

/** @typedef {{ lang: 'ru' | 'en', start: number, end: number }} Quote */

/** The address of a paragraph or of a quote in it. @param {string} ref @param {Quote | null} [quote] */
export function placeLink(ref, quote) {
  return `${location.origin}/${ref}${quote ? `?sel=${quote.lang}.${quote.start}-${quote.end}` : ''}`;
}

/** The quote of an address's "?sel=" (null — none, or not a valid one). @param {string} search */
export function quoteOf(search) {
  const m = new URLSearchParams(search).get('sel')?.match(/^(ru|en)\.(\d+)-(\d+)$/);
  if (!m) return null;
  const start = Number(m[2]), end = Number(m[3]);
  return end > start ? { lang: /** @type {'ru' | 'en'} */ (m[1]), start, end } : null;
}

/**
 * Gives a link away: on a phone the system's «Поделиться» (into a messenger, a letter…), elsewhere — or
 * where there is none (the Android app's WebView) — to the clipboard, the text with the link under it.
 * @param {string} url @param {string} [text] @param {string} [done] the note shown after copying
 */
export async function shareLink(url, text, done = 'Ссылка скопирована') {
  if (matchMedia('(pointer: coarse)').matches && navigator.share) {
    try {
      await navigator.share(text ? { text, url } : { url });
      return;
    } catch (err) {
      if (/** @type {Error} */ (err).name === 'AbortError') return; // closed by the person
    }
  }
  showToast((await writeText(text ? `${text}\n${url}` : url)) ? done : url);
}
