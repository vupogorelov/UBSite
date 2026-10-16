// @ts-check
// Query language → AST.
//   слово        any form (stemmed)            =слово     this exact form
//   слов*        prefix                         "a b"      consecutive words, any forms; ="a b" exact forms
//   -x / НЕ x    exclude                        a | b, a ИЛИ b, a OR b   alternatives
//   a ~5 b, a РЯДОМ/5 b, a NEAR/5 b            within 5 words
//   /regex/flags                                regular expression over the text
//   часть:1-2  текст:5,7  раздел:5:1  язык:ru|en|оба    filters
//   тег:космология  тег:a,b  #космология  -тег:вопросы     paragraphs with notes tagged so (with subtags)
// Clauses are ANDed; "|" binds tighter than AND (a | b c  ≡  (a OR b) AND c).
import { normalizeWord, stemWord } from './text.js';

/** @typedef {'ru' | 'en' | 'both'} Lang */
/** @typedef {{ norm: string, stem: string }} Word */
/** @typedef {{ kind: 'words', words: Word[], exact: boolean, prefix: boolean, lang: Lang }} WordsAtom — a term or a phrase */
/** @typedef {{ kind: 'regex', regex: RegExp, lang: Lang }} RegexAtom */
/** @typedef {{ kind: 'near', atoms: WordsAtom[], distance: number, lang: Lang }} NearAtom */
/** @typedef {WordsAtom | RegexAtom | NearAtom} Atom */
/** @typedef {{ neg: boolean, alts: Atom[] }} Clause */
/** @typedef {[number, number][]} Ranges */
/**
 * @typedef {{
 *   clauses: Clause[],
 *   parts: Set<number> | null,
 *   papers: Ranges | null,
 *   sections: { paper: number, from: number, to: number }[] | null,
 *   tags: string[][],
 *   excludeTags: string[],
 * }} Query
 * `tags`: every group must match (AND); a group matches if any of its tags does (OR).
 */

export class QueryError extends Error {}

const FILTER_KEYS = /** @type {Record<string, 'part' | 'paper' | 'section' | 'lang' | 'tag'>} */ ({
  часть: 'part', part: 'part', текст: 'paper', paper: 'paper', раздел: 'section', section: 'section', язык: 'lang', lang: 'lang',
  тег: 'tag', tag: 'tag',
});
const LANG_VALUES = /** @type {Record<string, Lang | 'auto'>} */ ({
  ru: 'ru', рус: 'ru', en: 'en', eng: 'en', анг: 'en', англ: 'en', оба: 'both', both: 'both', авто: 'auto', auto: 'auto',
});
const DEFAULT_NEAR = 10;

/** @param {string} value e.g. "1-3,5" @param {string} key */
function parseRanges(value, key) {
  /** @type {Ranges} */
  const out = [];
  for (const part of value.split(',')) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new QueryError(`Неверное значение фильтра ${key}:${value}`);
    out.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return out;
}

/** Language of letters in the text; escapes such as \w or \p{L} are not letters. */
function scriptOf(/** @type {string} */ text) {
  const t = text.replace(/\\[pP]\{[^}]*\}|\\./g, '');
  const ru = /[а-яё]/i.test(t);
  const en = /[a-z]/i.test(t);
  return ru && en ? 'both' : ru ? 'ru' : en ? 'en' : null;
}

/**
 * Makes \w, \W and \b understand Cyrillic (JS treats them as ASCII-only) and adds the "u" flag.
 * @param {string} source @param {string} flags
 */
export function compileRegex(source, flags) {
  const W = '\\p{L}\\p{M}\\p{N}_';
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[++i];
      if (next === 'w') out += inClass ? W : `[${W}]`;
      else if (next === 'W' && !inClass) out += `[^${W}]`;
      else if (next === 'b' && !inClass) out += `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;
      else if (next === 'B' && !inClass) out += `(?:(?<=[${W}])(?=[${W}])|(?<![${W}])(?![${W}]))`;
      else out += ch + next;
      continue;
    }
    if (ch === '[' && !inClass) inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    out += ch;
  }
  const f = new Set((flags || 'i').split(''));
  for (const x of f) if (!'imsu'.includes(x)) throw new QueryError(`Неизвестный флаг регулярного выражения: ${x}`);
  f.add('u');
  f.add('g');
  try {
    return new RegExp(out, [...f].join(''));
  } catch (err) {
    throw new QueryError(`Ошибка в регулярном выражении: ${/** @type {Error} */ (err).message.replace(/^Invalid regular expression: /, '')}`);
  }
}

/**
 * @typedef {{ type: 'or' } | { type: 'not' } | { type: 'near', distance: number }
 *   | { type: 'atom', neg: boolean, text: string, exact: boolean, prefix: boolean, phrase: boolean }
 *   | { type: 'regex', neg: boolean, source: string, flags: string }
 *   | { type: 'filter', key: 'part' | 'paper' | 'section' | 'lang' | 'tag', value: string, raw: string, neg: boolean }} Lexeme
 */

/** @param {string} input @returns {Lexeme[]} */
function lex(input) {
  /** @type {Lexeme[]} */
  const out = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') throw new QueryError('Скобки пока не поддерживаются');
    if (ch === '|') {
      out.push({ type: 'or' });
      i++;
      continue;
    }
    if (ch === '~') {
      const m = input.slice(i).match(/^~(\d*)/);
      out.push({ type: 'near', distance: m?.[1] ? Number(m[1]) : DEFAULT_NEAR });
      i += m?.[0].length ?? 1;
      continue;
    }
    // Prefixes: "-" (exclude) and "=" (exact form), in any order.
    let neg = false;
    let exact = false;
    let j = i;
    while ((input[j] === '-' || input[j] === '=') && j + 1 < input.length && !/\s/.test(input[j + 1])) {
      if (input[j] === '-') neg = true;
      else exact = true;
      j++;
    }
    if (input[j] === '"') {
      const close = input.indexOf('"', j + 1);
      const end = close === -1 ? input.length : close;
      out.push({ type: 'atom', neg, text: input.slice(j + 1, end), exact, prefix: false, phrase: true });
      i = end + 1;
      continue;
    }
    if (input[j] === '/') {
      let k = j + 1;
      let inClass = false;
      for (; k < input.length; k++) {
        if (input[k] === '\\') k++;
        else if (input[k] === '[') inClass = true;
        else if (input[k] === ']') inClass = false;
        else if (input[k] === '/' && !inClass) break;
      }
      if (k >= input.length) throw new QueryError('Регулярное выражение не закрыто: нужен «/» в конце');
      const flags = input.slice(k + 1).match(/^[a-z]*/)?.[0] ?? '';
      out.push({ type: 'regex', neg, source: input.slice(j + 1, k), flags });
      i = k + 1 + flags.length;
      continue;
    }
    let k = j;
    while (k < input.length && !/[\s"|]/.test(input[k])) k++;
    const word = input.slice(j, k);
    i = k;
    if (!exact) {
      const tag = word.match(/^#(.+)$/) ?? word.match(/^(?:тег|tag):(.+)$/iu);
      if (tag) {
        out.push({ type: 'filter', key: 'tag', value: tag[1], raw: word, neg });
        continue;
      }
    }
    if (!neg && !exact) {
      if (word === 'ИЛИ' || word === 'OR') {
        out.push({ type: 'or' });
        continue;
      }
      if (word === 'НЕ' || word === 'NOT') {
        out.push({ type: 'not' });
        continue;
      }
      if (word === 'И' || word === 'AND') continue;
      const near = word.match(/^(?:РЯДОМ|NEAR)(?:\/(\d+))?$/);
      if (near) {
        out.push({ type: 'near', distance: near[1] ? Number(near[1]) : DEFAULT_NEAR });
        continue;
      }
      const filter = word.match(/^([\p{L}]+):(.+)$/u);
      if (filter && FILTER_KEYS[filter[1].toLowerCase()]) {
        out.push({ type: 'filter', key: FILTER_KEYS[filter[1].toLowerCase()], value: filter[2], raw: word, neg: false });
        continue;
      }
    }
    const prefix = word.endsWith('*');
    out.push({ type: 'atom', neg, text: prefix ? word.slice(0, -1) : word, exact, prefix, phrase: false });
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Query}
 */
export function parseQuery(text) {
  /** @type {Query} */
  const query = { clauses: [], parts: null, papers: null, sections: null, tags: [], excludeTags: [] };
  /** @type {Lang | 'auto'} */
  let langFilter = 'auto';
  /** @type {{ neg: boolean, alts: (Lexeme & { type: 'atom' | 'regex' } | { type: 'near', distance: number, items: (Lexeme & { type: 'atom' })[] })[] }[]} */
  const raw = [];
  let pendingOr = false;
  let pendingNot = false;
  /** @type {number | null} */
  let pendingNear = null;

  for (const lx of lex(text)) {
    if (lx.type === 'filter') {
      if (lx.key === 'tag') {
        const names = lx.value.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
        if (!names.length) throw new QueryError(`Пустой тег в «${lx.raw}»`);
        if (lx.neg || pendingNot) query.excludeTags.push(...names);
        else query.tags.push(names);
        pendingNot = false;
      } else if (lx.key === 'lang') {
        const v = LANG_VALUES[lx.value.toLowerCase()];
        if (!v) throw new QueryError(`Неизвестный язык: ${lx.value} (ru, en или оба)`);
        langFilter = v;
      } else if (lx.key === 'part') {
        query.parts = new Set(parseRanges(lx.value, lx.raw).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)));
      } else if (lx.key === 'paper') {
        query.papers = parseRanges(lx.value, lx.raw);
      } else {
        const m = lx.value.match(/^(\d+):(\d+)(?:-(\d+))?$/);
        if (!m) throw new QueryError(`Раздел указывается как раздел:5:1 или раздел:5:1-3`);
        (query.sections ??= []).push({ paper: Number(m[1]), from: Number(m[2]), to: Number(m[3] ?? m[2]) });
      }
      continue;
    }
    if (lx.type === 'or') {
      if (!raw.length || pendingOr || pendingNear !== null) throw new QueryError('«ИЛИ» должно стоять между словами');
      pendingOr = true;
      continue;
    }
    if (lx.type === 'not') {
      pendingNot = true;
      continue;
    }
    if (lx.type === 'near') {
      if (!raw.length || pendingOr || pendingNear !== null) throw new QueryError('«РЯДОМ» должно стоять между словами');
      pendingNear = lx.distance;
      continue;
    }
    const neg = lx.neg || pendingNot;
    pendingNot = false;
    if (pendingNear !== null) {
      const prev = raw.at(-1);
      const last = prev?.alts.at(-1);
      if (!prev || prev.neg || neg || !last || last.type === 'regex' || lx.type === 'regex') {
        throw new QueryError('«РЯДОМ» соединяет только слова и фразы, без исключений и регулярных выражений');
      }
      if (last.type === 'near') {
        // one chain, one distance: «бог ~3 отец ~3 сын» (mixed ones would nest a chain in a chain)
        if (last.distance !== pendingNear) throw new QueryError('В одной цепочке «РЯДОМ» — одно расстояние: например, «бог ~3 отец ~3 сын»');
        last.items.push(lx);
      } else prev.alts[prev.alts.length - 1] = { type: 'near', distance: pendingNear, items: [last, lx] };
      pendingNear = null;
    } else if (pendingOr) {
      const prev = /** @type {(typeof raw)[number]} */ (raw.at(-1));
      if (prev.neg || neg) throw new QueryError('Исключение (-слово) нельзя сочетать с «ИЛИ»');
      prev.alts.push(lx);
      pendingOr = false;
    } else {
      raw.push({ neg, alts: [lx] });
    }
  }
  if (pendingOr || pendingNear !== null || pendingNot) throw new QueryError('Запрос оборван: после оператора нужно слово');

  /** @param {Lexeme & { type: 'atom' }} lx @returns {WordsAtom | null} */
  const wordsAtom = (lx) => {
    /** @type {Word[]} */
    const words = [];
    /** @type {Set<string>} */
    const scripts = new Set();
    for (const m of lx.text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’ʼ][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)) {
      const { norm, script } = normalizeWord(m[0]);
      words.push({ norm, stem: stemWord(norm, script) });
      if (script !== 'num') scripts.add(script);
    }
    if (!words.length) return null;
    if (scripts.size > 1) throw new QueryError(`Во фразе «${lx.text}» смешаны русские и английские слова`);
    const script = /** @type {'ru' | 'en' | undefined} */ ([...scripts][0]);
    return { kind: 'words', words, exact: lx.exact, prefix: lx.prefix, lang: script ?? (langFilter === 'auto' ? 'both' : langFilter) };
  };

  for (const c of raw) {
    /** @type {Atom[]} */
    const alts = [];
    for (const a of c.alts) {
      if (a.type === 'regex') {
        const s = scriptOf(a.source);
        alts.push({ kind: 'regex', regex: compileRegex(a.source, a.flags), lang: s ?? (langFilter === 'auto' ? 'both' : langFilter) });
      } else if (a.type === 'atom') {
        const w = wordsAtom(a);
        if (w) alts.push(w);
      } else {
        const atoms = a.items.map(wordsAtom).filter((x) => x !== null);
        if (atoms.length < 2) continue;
        const langs = new Set(atoms.map((x) => x.lang));
        if (langs.size > 1) throw new QueryError('Слова в «РЯДОМ» должны быть на одном языке');
        alts.push({ kind: 'near', atoms, distance: a.distance, lang: atoms[0].lang });
      }
    }
    if (alts.length) query.clauses.push({ neg: c.neg, alts });
  }
  if (!query.clauses.some((c) => !c.neg) && !query.tags.length) {
    throw new QueryError('Добавьте хотя бы одно слово или тег для поиска');
  }
  return query;
}
