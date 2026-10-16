// @ts-check
// Snowball Russian stemmer (https://snowballstem.org/algorithms/russian/stemmer.html).
// Expects a lower-case word with "ё" already replaced by "е".

const VOWELS = 'аеиоуыэюя';
const isVowel = (/** @type {string} */ ch) => VOWELS.includes(ch);

/** @param {string[]} list */
const byLength = (list) => [...list].sort((a, b) => b.length - a.length);

// Group 1 endings must be preceded by "а" or "я" (which stays); group 2 endings stand alone.
const PERFECTIVE_GERUND_1 = ['в', 'вши', 'вшись'];
const PERFECTIVE_GERUND_2 = ['ив', 'ивши', 'ившись', 'ыв', 'ывши', 'ывшись'];
const ADJECTIVE = byLength([
  'ее', 'ие', 'ые', 'ое', 'ими', 'ыми', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом',
  'его', 'ого', 'ему', 'ому', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею',
]);
const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ'];
const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const REFLEXIVE = byLength(['ся', 'сь']);
const VERB_1 = ['ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'ешь', 'нно'];
const VERB_2 = [
  'ила', 'ыла', 'ена', 'ейте', 'уйте', 'ите', 'или', 'ыли', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен',
  'ило', 'ыло', 'ено', 'ят', 'ует', 'уют', 'ит', 'ыт', 'ены', 'ить', 'ыть', 'ишь', 'ую', 'ю',
];
const NOUN = byLength([
  'а', 'ев', 'ов', 'ие', 'ье', 'е', 'иями', 'ями', 'ами', 'еи', 'ии', 'и', 'ией', 'ей', 'ой', 'ий', 'й',
  'иям', 'ям', 'ием', 'ем', 'ам', 'ом', 'о', 'у', 'ах', 'иях', 'ях', 'ы', 'ь', 'ию', 'ью', 'ю', 'ия', 'ья', 'я',
]);
const SUPERLATIVE = byLength(['ейш', 'ейше']);
const DERIVATIONAL = byLength(['ост', 'ость']);

/**
 * Two-group "among": the longest matching ending wins; a group-1 ending then also needs
 * a preceding "а"/"я" inside RV, otherwise the step fails (no retry with shorter endings).
 * @param {string} word @param {number} rv @param {string[]} group1 @param {string[]} group2
 * @returns {string | null} the word with the ending removed, or null
 */
function removeGrouped(word, rv, group1, group2) {
  let best = '';
  let inGroup1 = false;
  for (const e of group1) if (e.length > best.length && word.endsWith(e) && word.length - e.length >= rv) (best = e), (inGroup1 = true);
  for (const e of group2) if (e.length > best.length && word.endsWith(e) && word.length - e.length >= rv) (best = e), (inGroup1 = false);
  if (!best) return null;
  const cut = word.length - best.length;
  if (inGroup1 && !(cut - 1 >= rv && (word[cut - 1] === 'а' || word[cut - 1] === 'я'))) return null;
  return word.slice(0, cut);
}

/**
 * Removes the longest ending that lies entirely inside the region starting at `limit`.
 * @param {string} word @param {number} limit @param {string[]} endings longest first
 */
function removeLongest(word, limit, endings) {
  for (const e of endings) if (word.endsWith(e) && word.length - e.length >= limit) return word.slice(0, -e.length);
  return null;
}

/** @param {string} word */
export function stemRu(word) {
  // RV: after the first vowel. R2: standard R2 (after vowel+consonant, twice).
  let rv = word.length;
  let i = 0;
  while (i < word.length && !isVowel(word[i])) i++;
  if (i < word.length) rv = i + 1;
  let r2 = word.length;
  {
    let j = rv;
    while (j < word.length && isVowel(word[j])) j++;
    j++; // past the first consonant after the vowel → R1
    while (j < word.length && !isVowel(word[j])) j++;
    while (j < word.length && isVowel(word[j])) j++;
    j++;
    if (j <= word.length) r2 = j;
  }

  // Step 1
  let w = removeGrouped(word, rv, PERFECTIVE_GERUND_1, PERFECTIVE_GERUND_2);
  if (w === null) {
    w = removeLongest(word, rv, REFLEXIVE) ?? word;
    const adj = removeLongest(w, rv, ADJECTIVE);
    if (adj !== null) {
      w = removeGrouped(adj, rv, PARTICIPLE_1, PARTICIPLE_2) ?? adj;
    } else {
      w = removeGrouped(w, rv, VERB_1, VERB_2) ?? removeLongest(w, rv, NOUN) ?? w;
    }
  }

  // Step 2
  if (w.endsWith('и') && w.length - 1 >= rv) w = w.slice(0, -1);

  // Step 3: the longest derivational ending in RV is removed only if it also lies in R2
  const cur = w; // (the word so far, for the callback)
  const der = DERIVATIONAL.find((e) => cur.endsWith(e) && cur.length - e.length >= rv);
  if (der && w.length - der.length >= r2) w = w.slice(0, -der.length);

  // Step 4: superlative / double "н" / soft sign
  const sup = removeLongest(w, rv, SUPERLATIVE);
  if (sup !== null) {
    w = sup.endsWith('нн') && sup.length - 2 >= rv ? sup.slice(0, -1) : sup;
  } else if (w.endsWith('нн') && w.length - 2 >= rv) {
    w = w.slice(0, -1);
  } else if (w.endsWith('ь') && w.length - 1 >= rv) {
    w = w.slice(0, -1);
  }
  return w;
}
