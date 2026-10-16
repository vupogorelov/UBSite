// @ts-check
// Tokenization and normalization shared by indexing, query parsing and highlighting —
// all three must agree, otherwise highlights drift away from what the index matched.
import { stemRu } from './stem-ru.js';
import { stemEn } from './stem-en.js';

/** @typedef {'ru' | 'en' | 'num'} Script */
/** @typedef {{ start: number, end: number, norm: string, stem: string, script: Script }} Token */

// A word: letters/digits (with combining marks), optionally joined by apostrophes (Father’s, don't).
export const WORD =/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’ʼ][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;

// Latin letters that look like Cyrillic ones and vice versa (typos such as "cангиков").
const LAT_TO_CYR = /** @type {Record<string, string>} */ ({ a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у' });
const CYR_TO_LAT = Object.fromEntries(Object.entries(LAT_TO_CYR).map(([l, c]) => [c, l]));

/**
 * Lower case, ё→е, no apostrophes or stress marks, homoglyphs fixed by the majority script.
 * @param {string} word
 * @returns {{ norm: string, script: Script }}
 */
export function normalizeWord(word) {
  // After NFC only stray combining marks (stress accents) remain as \p{M}; FTS5 would split on them.
  let w = word.normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/['’ʼ\p{M}]/gu, '');
  const cyr = (w.match(/[а-я]/g) ?? []).length;
  const lat = (w.match(/[a-z]/g) ?? []).length;
  if (cyr && lat) {
    w = cyr >= lat ? w.replace(/[a-z]/g, (ch) => LAT_TO_CYR[ch] ?? ch) : w.replace(/[а-я]/g, (ch) => CYR_TO_LAT[ch] ?? ch);
  }
  return { norm: w, script: cyr >= lat ? (cyr ? 'ru' : lat ? 'en' : 'num') : 'en' };
}

/** @type {Map<string, string>} */
const stemCache = new Map();
/** Russian stems with a fleeting vowel → their short variant (отец → отц). */
let ruAliases = new Map();

/** @param {Map<string, string>} aliases */
export function setStemAliases(aliases) {
  ruAliases = aliases;
  stemCache.clear();
}

/** @param {string} norm @param {Script} script */
export function stemWord(norm, script) {
  if (script === 'num') return norm;
  const key = script + norm;
  let stem = stemCache.get(key);
  if (stem === undefined) {
    stem = script === 'ru' ? stemRu(norm) : stemEn(norm);
    if (script === 'ru') stem = ruAliases.get(stem) ?? stem;
    if (stemCache.size > 200_000) stemCache.clear();
    stemCache.set(key, stem);
  }
  return stem;
}

// Snowball keeps fleeting vowels, so отец/отца, любовь/любви, ребенок/ребенка get different stems.
// Merge such pairs when the book itself shows both: the long stem as a bare word (отец, любовь)
// and the short one only with endings (отца, любви). Restricted to the typical suffixes.
const C = 'бвгджзйклмнпрстфхцчшщ';
const FLEETING_BARE = new RegExp(`^(.*[${C}])(?:[ое]к|е[цлр])$`); // ребенок, отец, пепел, ветер
const FLEETING_SOFT = new RegExp(`^(.*[${C}])(?:[ое]н|ов)$`); // камень, огонь, любовь (+ь)
// ≠ Англия, проблема, весло, проплыть, очнуться, ступня
const FLEETING_EXCLUDE = new Set(['ангел', 'пробел', 'весел', 'пропел', 'очен', 'ступен']);

/**
 * @param {Iterable<string>} texts Russian paragraphs of the book
 * @returns {Map<string, string>}
 */
export function findFleetingAliases(texts) {
  const forms = new Set();
  const stems = new Set();
  for (const text of texts) {
    for (const m of text.matchAll(WORD)) {
      const { norm, script } = normalizeWord(m[0]);
      if (script !== 'ru') continue;
      forms.add(norm);
      stems.add(stemRu(norm));
    }
  }
  const aliases = new Map();
  for (const stem of stems) {
    if (FLEETING_EXCLUDE.has(stem)) continue;
    let m = stem.match(FLEETING_BARE);
    const bare = m && forms.has(stem);
    if (!bare) m = stem.match(FLEETING_SOFT);
    if (!m || (!bare && !forms.has(stem + 'ь'))) continue;
    const short = m[1] + stem.at(-1);
    if (stems.has(short) && !forms.has(short)) aliases.set(stem, short);
  }
  return aliases;
}

/**
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  for (const m of text.matchAll(WORD)) {
    const { norm, script } = normalizeWord(m[0]);
    tokens.push({ start: m.index, end: m.index + m[0].length, norm, stem: stemWord(norm, script), script });
  }
  return tokens;
}

/** Same-length transformation used for regex search, so match offsets stay valid. */
export function foldForRegex(/** @type {string} */ text) {
  return text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}
