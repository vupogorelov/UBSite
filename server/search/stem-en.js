// @ts-check
// Snowball English (Porter2) stemmer (https://snowballstem.org/algorithms/english/stemmer.html).
// Expects a lower-case word without apostrophes.

const isVowel = (/** @type {string | undefined} */ ch) => ch !== undefined && 'aeiouy'.includes(ch);

/** @type {Record<string, string>} */
const EXCEPTIONS1 = {
  skis: 'ski', skies: 'sky', dying: 'die', lying: 'lie', tying: 'tie', idly: 'idl', gently: 'gentl',
  ugly: 'ugli', early: 'earli', only: 'onli', singly: 'singl', sky: 'sky', news: 'news', howe: 'howe',
  atlas: 'atlas', cosmos: 'cosmos', bias: 'bias', andes: 'andes',
};
const EXCEPTIONS2 = new Set(['inning', 'outing', 'canning', 'herring', 'earring', 'proceed', 'exceed', 'succeed']);

/** Position after the first non-vowel that follows a vowel, searching from `start`. */
function regionAfter(/** @type {string} */ w, /** @type {number} */ start) {
  for (let i = start + 1; i < w.length; i++) if (isVowel(w[i - 1]) && !isVowel(w[i])) return i + 1;
  return w.length;
}

function endsWithShortSyllable(/** @type {string} */ w) {
  const n = w.length;
  if (n === 2) return isVowel(w[0]) && !isVowel(w[1]);
  return n >= 3 && !isVowel(w[n - 3]) && isVowel(w[n - 2]) && !isVowel(w[n - 1]) && !'wxY'.includes(w[n - 1]);
}

/** @typedef {[suffix: string, replacement: string, condition?: (stem: string) => boolean]} Rule */

/**
 * Applies the rule with the longest matching suffix, if the suffix starts at or after `limit`.
 * @param {string} w @param {number} limit @param {Rule[]} rules sorted longest first
 */
function applyLongest(w, limit, rules) {
  for (const [suffix, replacement, condition] of rules) {
    if (!w.endsWith(suffix)) continue;
    const stem = w.slice(0, -suffix.length);
    return stem.length >= limit && (!condition || condition(stem)) ? stem + replacement : w;
  }
  return w;
}

/** @param {Rule[]} rules */
const longestFirst = (rules) => rules.sort((a, b) => b[0].length - a[0].length);

const STEP2 = longestFirst([
  ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['abli', 'able'], ['entli', 'ent'],
  ['izer', 'ize'], ['ization', 'ize'], ['ational', 'ate'], ['ation', 'ate'], ['ator', 'ate'],
  ['alism', 'al'], ['aliti', 'al'], ['alli', 'al'], ['fulness', 'ful'], ['ousli', 'ous'], ['ousness', 'ous'],
  ['iveness', 'ive'], ['iviti', 'ive'], ['biliti', 'ble'], ['bli', 'ble'], ['ogi', 'og', (s) => s.endsWith('l')],
  ['fulli', 'ful'], ['lessli', 'less'], ['li', '', (s) => 'cdeghkmnrt'.includes(s.at(-1) ?? '')],
]);
const STEP3 = longestFirst([
  ['tional', 'tion'], ['ational', 'ate'], ['alize', 'al'], ['icate', 'ic'], ['iciti', 'ic'], ['ical', 'ic'],
  ['ful', ''], ['ness', ''],
]);
const STEP4 = longestFirst(
  ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize']
    .map((s) => /** @type {Rule} */ ([s, '']))
    .concat([['ion', '', (s) => s.endsWith('s') || s.endsWith('t')]]),
);

/** @param {string} word */
export function stemEn(word) {
  if (word.length <= 2) return word;
  if (Object.hasOwn(EXCEPTIONS1, word)) return EXCEPTIONS1[word];

  // Consonant "y": at the start or after a vowel.
  let w = '';
  for (let i = 0; i < word.length; i++) {
    w += word[i] === 'y' && (i === 0 || isVowel(w[i - 1])) ? 'Y' : word[i];
  }

  const prefix = /^(gener|commun|arsen)/.exec(w);
  const r1 = prefix ? prefix[0].length : regionAfter(w, 0);
  const r2 = regionAfter(w, r1);

  // Step 1a
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ied') || w.endsWith('ies')) w = w.slice(0, -3) + (w.length > 4 ? 'i' : 'ie');
  else if (w.endsWith('us') || w.endsWith('ss')) {
    // unchanged
  } else if (w.endsWith('s') && /[aeiouy]/.test(w.slice(0, -2))) w = w.slice(0, -1);

  if (EXCEPTIONS2.has(w)) return w;

  // Step 1b
  const s1b = ['eedly', 'ingly', 'edly', 'eed', 'ing', 'ed'].find((s) => w.endsWith(s));
  if (s1b === 'eed' || s1b === 'eedly') {
    if (w.length - s1b.length >= r1) w = w.slice(0, -s1b.length) + 'ee';
  } else if (s1b) {
    const stem = w.slice(0, -s1b.length);
    if (/[aeiouy]/.test(stem)) {
      w = stem;
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/(bb|dd|ff|gg|mm|nn|pp|rr|tt)$/.test(w)) w = w.slice(0, -1);
      else if (endsWithShortSyllable(w) && r1 >= w.length) w += 'e';
    }
  }

  // Step 1c
  if ((w.endsWith('y') || w.endsWith('Y')) && w.length > 2 && !isVowel(w[w.length - 2])) w = w.slice(0, -1) + 'i';

  w = applyLongest(w, r1, STEP2);
  // Step 3: "ative" needs R2, the rest R1.
  if (w.endsWith('ative')) w = w.length - 5 >= r2 ? w.slice(0, -5) : w;
  else w = applyLongest(w, r1, STEP3);
  w = applyLongest(w, r2, STEP4);

  // Step 5
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1);
    if (stem.length >= r2 || (stem.length >= r1 && !endsWithShortSyllable(stem))) w = stem;
  } else if (w.endsWith('ll') && w.length - 1 >= r2) {
    w = w.slice(0, -1);
  }

  return w.replace(/Y/g, 'y');
}
