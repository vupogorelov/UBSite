// @ts-check
// The pronunciation dictionary applied to a sentence before it goes to speech synthesis.
// A rule matches the start of a word, case-insensitively, so one rule covers every case form of a
// name ("Небадон" → "Небадона", "Небадону"); the rest of the word stays. A stress is written as "+"
// before the vowel and stored as U+0301 after it (most engines honour it).

const STRESS = '́';

/** "Небад+он" → "Небадо́н". @param {string} s */
export const withStress = (s) => s.replace(/\+([аеёиоуыэюяaeiouy])/giu, `$1${STRESS}`);
/** "Небадо́н" → "Небад+он" (for editing). @param {string} s */
export const toPlus = (s) => s.replace(new RegExp(`([аеёиоуыэюяaeiouy])${STRESS}`, 'giu'), '+$1');

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{ written: string, spoken: string }[]} rules
 * @returns {{ re: RegExp, spoken: string }[]} longest first (a longer rule wins over its prefix)
 */
export function compile(rules) {
  return rules
    .filter((r) => r.written.trim() && r.spoken.trim())
    .toSorted((a, b) => b.written.length - a.written.length)
    .map((r) => ({ re: new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(r.written.trim())}`, 'giu'), spoken: r.spoken.trim() }));
}

/** @param {string} text @param {{ re: RegExp, spoken: string }[]} compiled */
export function pronounce(text, compiled) {
  let out = text;
  for (const { re, spoken } of compiled) {
    out = out.replace(re, (m) => {
      // The first letter's case comes from the text ("Небадон" at a sentence start, "урантийцы").
      const upper = m[0] !== m[0].toLowerCase();
      return (upper ? spoken[0].toUpperCase() : spoken[0].toLowerCase()) + spoken.slice(1);
    });
  }
  return out;
}
