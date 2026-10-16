// @ts-check
// Where the glossary's terms stand in the book's paragraphs, in both languages — for the reader's
// "pairs of terms": the mouse over a term lights it and its counterpart in the other language.
// A Russian word is matched by its beginning and the endings of its own declension (Сатана: -ы, -ой…;
// Сатания: -ии, -ией…), so names whose stems differ between forms are found ("Адам" / "Адама",
// "Египет" / "Египта"), and an adjective made of a name too ("Рай" → "Райский"); failing that, by the
// stem. An English word by its stem. A term written with a capital letter is matched only so written.
import { tokenize, normalizeWord, stemWord, setStemAliases } from '../shared/search/text.js';

/** @typedef {import('../shared/search/text.js').Token} Token */
/** @typedef {(t: Token, text: string) => number} WordMatch 2: a form of the word, 1: the same stem, 0: no */
/** @typedef {{ id: number, words: WordMatch[], first: string[], len: number }} Matcher */

const set = (/** @type {string} */ s) => new Set(s.split(' ').map((x) => (x === '-' ? '' : x)));
const ADJ = set('ый ий ой ая яя ое ее ые ие ого его ому ему ым им ом ем ей ую юю ых их ыми ими ою ею');
/** The declensions: the dictionary form's ending → how much of it goes, the endings that come instead. */
const DECLENSIONS = /** @type {[RegExp, number, Set<string>][]} */ ([
  [/(ый|ой|ая|яя|ое|ее|ые)$/, 2, ADJ],
  [/ий$/, 2, new Set([...ADJ, ...set('ия ию ием ии иев иям иях')])],
  [/ие$/, 2, new Set([...ADJ, ...set('ия ию ием ии иям иях иями')])],
  [/ия$/, 2, set('ия ии ию ией иею ий иям иях иями')],
  [/[ая]$/, 1, set('а я ы и е у ю ой ей ою ею ам ям ами ями ах ях -')],
  [/[ое]$/, 1, set('о е а я у ю ом ем ам ям ами ями ах ях -')],
  [/й$/, 1, set('й я ю ем е и ев ям ями ях')],
  [/ь$/, 1, set('ь я ю ем е и ей ям ями ях ью')],
  [/[ыи]$/, 1, set('ы и ов ев ам ям ами ями ах ях - а у е ом')],
  [/$/, 0, set('- а у ом е ы и ов ам ами ах ей ем ю я ям ями ях')],
]);
const UP = /^\p{Lu}/u;

/**
 * One word of a term. @param {string} word as the glossary writes it @param {'ru' | 'en'} lang
 * @returns {{ match: WordMatch, keys: string[] }} keys: the beginnings a matching token starts with (an index)
 */
function wordMatcher(word, lang) {
  const { norm, script } = normalizeWord(word);
  const stem = stemWord(norm, script);
  const capital = UP.test(word);
  /** @type {(t: Token, text: string) => boolean} */
  const cased = (t, text) => !capital || UP.test(text[t.start]);
  if (lang === 'en' || script !== 'ru') {
    return { match: (t, text) => (t.stem === stem && cased(t, text) ? 2 : 0), keys: [stem.slice(0, 3)] };
  }
  const [, cut, endings] = /** @type {[RegExp, number, Set<string>]} */ (DECLENSIONS.find(([re]) => re.test(norm)));
  const base = norm.slice(0, norm.length - cut);
  // a fleeting vowel (Египет → Египта) — in longer words only: "Ева" is not "в"
  const bases = [...new Set([base, base.length >= 4 ? base.replace(/[ое]([бвгджзклмнпрстфхцчшщ])$/, '$1') : base])];
  // an adjective of the name: Рай → Райский, Небадон → Небадонский
  const roots = cut <= 1 ? [...new Set([norm, base])] : [];
  /** @param {string} w */
  const form = (w) =>
    bases.some((b) => w.startsWith(b) && endings.has(w.slice(b.length))) ||
    roots.some((r) => w.startsWith(r + 'ск') && ADJ.has(w.slice(r.length + 2)));
  return {
    // the stem as the last resort, and not a short one ("Ной" and "Но")
    match: (t, text) => (!cased(t, text) ? 0 : form(t.norm) ? 2 : stem.length >= 4 && t.stem === stem ? 1 : 0),
    keys: [...new Set([...bases, ...roots, stem].map((b) => b.slice(0, 3)))],
  };
}

/** Between two words of a term: spaces or a hyphen, not a comma or a sentence's end. */
const JOINED = /^[\s -]*$/;

/**
 * Matchers of the terms, longest first. @param {{ id: number, en: string, ru: string }[]} terms
 * @returns {{ ru: Matcher[], en: Matcher[] }}
 */
export function termMatchers(terms) {
  /** @param {'ru' | 'en'} lang */
  const build = (lang) =>
    terms
      .map((t) => {
        const words = tokenize(t[lang]).map((w) => wordMatcher(t[lang].slice(w.start, w.end), lang));
        return { id: t.id, words: words.map((w) => w.match), first: words[0]?.keys ?? [], len: t[lang].length };
      })
      .filter((m) => m.words.length)
      .sort((a, b) => b.words.length - a.words.length);
  return { ru: build('ru'), en: build('en') };
}

/**
 * The terms in a text: [start, end, termId] in order, not overlapping (the longest wins).
 * @param {string} text @param {Matcher[]} matchers
 * @returns {[number, number, number][]}
 */
export function findTerms(text, matchers) {
  /** @type {Map<string, Matcher[]>} by the first three letters of the first word */
  const index = new Map();
  for (const m of matchers) for (const k of m.first) index.set(k, [...(index.get(k) ?? []), m]);
  const toks = tokenize(text);
  /** @type {[number, number, number][]} */
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const candidates = new Set([...(index.get(toks[i].norm.slice(0, 3)) ?? []), ...(index.get(toks[i].stem.slice(0, 3)) ?? [])]);
    // the best: the most words, then forms of the words rather than shared stems, then the longer term
    /** @type {{ m: Matcher, n: number, score: number } | null} */
    let hit = null;
    for (const m of candidates) {
      const n = m.words.length;
      if (i + n > toks.length || (hit && n < hit.n)) continue;
      let score = 0;
      for (let k = 0; k < n; k++) {
        const s = k === 0 || JOINED.test(text.slice(toks[i + k - 1].end, toks[i + k].start)) ? m.words[k](toks[i + k], text) : 0;
        if (!s) {
          score = 0;
          break;
        }
        score += s;
      }
      if (score && (!hit || n > hit.n || score > hit.score || (score === hit.score && m.len > hit.m.len))) hit = { m, n, score };
    }
    if (hit) {
      out.push([toks[i].start, toks[i + hit.n - 1].end, hit.m.id]);
      i += hit.n - 1;
    }
  }
  return out;
}

/**
 * The terms of a paper's paragraphs, cached per paper until the glossary changes.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ list: () => { id: number, en: string, ru: string }[], version: () => number }} glossary
 */
export function createTermIndex(db, glossary) {
  // the search's merges of stems with a fleeting vowel (отец / отца), as the index has them
  const aliases = /** @type {{ value: string } | undefined} */ (db.prepare("SELECT value FROM meta WHERE key = 'ru_stem_aliases'").get());
  if (aliases) setStemAliases(new Map(JSON.parse(aliases.value)));
  const paras = db.prepare('SELECT ref, plain_ru AS ru, plain_en AS en FROM paragraphs WHERE paper_id = ? ORDER BY seq');
  /** @type {Map<number, any>} */
  const cache = new Map();
  let version = -1;
  /** @type {ReturnType<typeof termMatchers> | null} */
  let matchers = null;
  return {
    /**
     * @param {number} paperId
     * @returns {{ terms: [number, string, string][], paras: Record<string, { ru: number[], en: number[] }> }}
     * occurrences flat: start, end, termId, start, end, termId, …
     */
    paper(paperId) {
      if (version !== glossary.version()) {
        version = glossary.version();
        cache.clear();
        matchers = null;
      }
      const hit = cache.get(paperId);
      if (hit) return hit;
      const list = glossary.list();
      matchers ??= termMatchers(list);
      const m = /** @type {ReturnType<typeof termMatchers>} */ (matchers);
      /** @type {Record<string, { ru: number[], en: number[] }>} */
      const byRef = {};
      const used = new Set();
      for (const p of /** @type {{ ref: string, ru: string, en: string }[]} */ (paras.all(paperId))) {
        const ru = findTerms(p.ru, m.ru), en = findTerms(p.en, m.en);
        if (!ru.length && !en.length) continue;
        for (const x of [...ru, ...en]) used.add(x[2]);
        byRef[p.ref] = { ru: ru.flat(), en: en.flat() };
      }
      const out = { terms: /** @type {[number, string, string][]} */ (list.filter((t) => used.has(t.id)).map((t) => [t.id, t.en, t.ru])), paras: byRef };
      if (cache.size > 40) cache.clear();
      cache.set(paperId, out);
      return out;
    },
  };
}
