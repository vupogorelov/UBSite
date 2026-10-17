// @ts-check
// Which words the reader marks (the setting «Подсказки словаря»): in each section (§) of a paper, the first
// place each article of the dictionary is named — once, so the text is not spotted all over. Pure: the
// paper's terms (server/terms.js) and the articles' glossary entries in, the places out.

/** @typedef {{ ref: string, start: number, end: number, article: number }} Mark */

/**
 * @param {Record<string, { ru: number[], en: number[] }>} paras the paper's terms per paragraph, in the book's
 *   order: flat triples start, end, glossary id
 * @param {Map<number, number>} articleOf glossary id → article id
 * @param {'ru' | 'en'} lang the reading language (the comparison text under it is not marked)
 * @returns {Mark[]}
 */
export function firstMentions(paras, articleOf, lang) {
  /** @type {Mark[]} */
  const out = [];
  let section = '';
  const seen = new Set();
  for (const [ref, x] of Object.entries(paras)) {
    const s = ref.slice(0, ref.lastIndexOf('.')); // "5:1" of "5:1.3"
    if (s !== section) {
      section = s;
      seen.clear();
    }
    const list = x[lang] ?? [];
    for (let i = 0; i + 2 < list.length; i += 3) {
      const article = articleOf.get(list[i + 2]);
      if (article === undefined || seen.has(article)) continue;
      seen.add(article);
      out.push({ ref, start: list[i], end: list[i + 1], article });
    }
  }
  return out;
}
