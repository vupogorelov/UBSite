// @ts-check
// «Картинка» of a quote: what to draw (the words, their language, the place and its link). Any place of
// the app opens it (the text's actions now; messages and notes later); the sheet is in the shell.

/** @typedef {{ text: string, lang: 'ru' | 'en', ref: string, link: string }} QuoteCardSource */

/** @type {{ source: QuoteCardSource | null }} */
export const quoteCard = $state({ source: null });

/** @param {QuoteCardSource} source */
export function openQuoteCard(source) {
  quoteCard.source = { ...source, text: source.text.replace(/\s+/g, ' ').trim() };
}

export function closeQuoteCard() {
  quoteCard.source = null;
}
