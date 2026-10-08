// @ts-check
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Foreword sections are numbered with Roman numerals, all other papers with Arabic. */
export function sectionLabel(/** @type {number} */ paperId, /** @type {number} */ num) {
  return paperId === 0 ? ROMAN[num] ?? String(num) : String(num);
}

export function partLabel(/** @type {number} */ partId) {
  return ROMAN[partId] ?? String(partId);
}

/** Russian plural: plural(5, 'абзац', 'абзаца', 'абзацев') → 'абзацев'. */
export function plural(/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ few, /** @type {string} */ many) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

export function paperLabel(/** @type {number} */ paperId) {
  return paperId === 0 ? 'Предисловие' : `Текст ${paperId}`;
}
