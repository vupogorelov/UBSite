// @ts-check
// The default name of a bookmark: the first words of the sentence the bookmark starts in
// (for a whole paragraph — of its first sentence).

const WORDS = 6;

/**
 * @param {string} text the paragraph's plain text
 * @param {number} [at] offset of the bookmarked fragment (0 — the paragraph's start)
 * @returns {string} e.g. "Неспособность конечного создания приблизиться к бесконечному…"
 */
export function defaultBookmarkTitle(text, at = 0) {
  // The sentence holding `at` begins after the last ". ", "! ", "? ", "… " (with closing quotes) before it.
  let start = 0;
  for (const m of text.slice(0, Math.max(0, at)).matchAll(/[.!?…]+[»"”')\]]*\s+/g)) start = /** @type {number} */ (m.index) + m[0].length;
  const end = text.slice(start).search(/[.!?…](?=[»"”')\]]*(\s|$))/);
  const sentence = (end < 0 ? text.slice(start) : text.slice(start, start + end)).trim();
  const words = sentence.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const head = words.slice(0, WORDS).join(' ').replace(/[,;:—–-]+$/, '');
  return words.length > WORDS ? `${head}…` : head;
}
