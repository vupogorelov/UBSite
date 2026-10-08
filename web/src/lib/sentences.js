// @ts-check
// Sentence bounds for reading aloud.

/**
 * A break after . ! ? … (and closing quotes/brackets) followed by a capital letter, a digit or an
 * opening quote/dash — so "т. е. так" and "и т. д., а" stay inside one sentence. The bounds leave
 * the spaces between sentences out; empty pieces are dropped.
 * @param {string} text @returns {[number, number][]}
 */
export function sentences(text) {
  /** @type {[number, number][]} */
  const out = [];
  const re = /[.!?…]+[»"”')\]]*(\s+)(?=[«"„“(\-–—]?\s*[\p{Lu}\d])/gu;
  let a = 0;
  for (const m of text.matchAll(re)) {
    const end = /** @type {number} */ (m.index) + m[0].length - m[1].length;
    out.push([a, end]);
    a = end + m[1].length;
  }
  if (a < text.length) out.push([a, text.length]);
  return out.filter(([x, y]) => text.slice(x, y).trim());
}
