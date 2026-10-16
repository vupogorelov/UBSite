// @ts-check
// Finds a piece of text inside an element as a DOM Range, across tags (the book's HTML), ignoring
// differences of whitespace and soft hyphens between a quote and the page.

/** @param {string} s */
const norm = (s) => s.replace(/­/g, '').replace(/\s+/g, ' ').trim();

/**
 * @param {Element} root @param {string} quote
 * @returns {Range | null}
 */
export function findText(root, quote) {
  const want = norm(quote);
  if (!want) return null;
  let text = '';
  /** @type {[Text, number][]} each character of `text` → where it is in the page */
  const at = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = /** @type {Text | null} */ (walker.nextNode()); node; node = /** @type {Text | null} */ (walker.nextNode())) {
    const s = node.data;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '­') continue;
      const ch = /\s/.test(s[i]) ? ' ' : s[i];
      if (ch === ' ' && (text === '' || text.endsWith(' '))) continue;
      text += ch;
      at.push([node, i]);
    }
  }
  const i = text.indexOf(want);
  if (i < 0) return null;
  const range = document.createRange();
  range.setStart(at[i][0], at[i][1]);
  const [end, offset] = at[i + want.length - 1];
  range.setEnd(end, offset + 1);
  return range;
}
