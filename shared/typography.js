// @ts-check
// The book's typography for the screen. A large number is written in groups of three digits with a space
// between them ("611 121"): the space is made non-breaking, so justified text with hyphenation never
// pulls the groups apart or puts them on two lines, as if they were two numbers. A character for a
// character: the text's length and every offset in it stay the same (notes, search, the highlight).

const GROUP = /(\d) (?=\d{3}(?!\d))/g;

/**
 * Non-breaking spaces between a number's groups of digits, in the text of HTML (not inside its tags).
 * @param {string} html
 */
export function keepNumbers(html) {
  return html
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 ? part : part.replace(GROUP, '$1 ')))
    .join('');
}
