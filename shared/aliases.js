// @ts-check
// Names shown another way (the dictionary of names): where a name stands in a text, and what to show
// in its place. A name is matched at a word's start with its ending: "Салвингтона" → "Спасограда",
// "Салвингтонский" → "Спасоградский"; a form listed in `forms` is taken as it is ("Декаполиса" →
// "Десятиградия"); an alias of several words takes the ending on its first word ("Солитарингтона" →
// "Града Одиночности").

/** @typedef {{ written: string, alias: string, forms?: Record<string, string> }} Alias */

const LETTER = /\p{L}/u;

/**
 * The places of the names in a plain text, in order, not overlapping.
 * @param {string} text @param {Alias[]} list
 * @returns {{ start: number, end: number, text: string, original: string }[]}
 */
export function findAliases(text, list) {
  /** @type {{ start: number, end: number, text: string, original: string }[]} */
  const out = [];
  for (const a of list) {
    let i = text.indexOf(a.written);
    while (i >= 0) {
      if (i === 0 || !LETTER.test(text[i - 1])) {
        let end = i + a.written.length;
        while (end < text.length && /\p{Ll}/u.test(text[end])) end++;
        const word = text.slice(i, end);
        const suffix = word.slice(a.written.length);
        const space = a.alias.indexOf(' ');
        const shown = a.forms?.[word] ?? (space > 0 ? a.alias.slice(0, space) + suffix + a.alias.slice(space) : a.alias + suffix);
        out.push({ start: i, end, text: shown, original: word });
      }
      i = text.indexOf(a.written, i + a.written.length);
    }
  }
  out.sort((x, y) => x.start - y.start);
  return out.filter((x, k) => k === 0 || x.start >= out[k - 1].end);
}

/**
 * A search query with the aliases written back as the translation has them ("Спасограде" →
 * "Салвингтоне"), so that the text, which has the translation's names, is found.
 * @param {string} q @param {Alias[]} list
 */
export function unalias(q, list) {
  let s = q;
  for (const a of list) {
    if (a.alias.includes(' ')) continue;
    s = s.replace(new RegExp(`(^|[^\\p{L}])${a.alias}(\\p{Ll}*)`, 'gu'), (_, pre, end) => pre + a.written + end);
  }
  return s;
}
