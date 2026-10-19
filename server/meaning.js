// @ts-check
// The search by meaning, as the platform's search offers it (server/api/search.js): a place for whoever can
// answer — the Laboratory's model (features/lab) — to join in. None joined (or it cannot answer now): the
// search is by the words only.

/**
 * The paragraphs closest to a text, best first: `meaning` — by the model alone; `hybrid` — the model's
 * first, the words adding what it missed. null — it cannot answer now (no model worked out yet).
 * @typedef {(text: string, mode: 'meaning' | 'hybrid', limit: number) => Promise<string[] | null>} MeaningFinder
 */

export function createMeaning() {
  /** @type {MeaningFinder | null} */
  let finder = null;
  return {
    /** @param {MeaningFinder | null} fn */
    use(fn) {
      finder = fn;
    },
    /** @param {string} text @param {'meaning' | 'hybrid'} mode @param {number} limit */
    async find(text, mode, limit) {
      return finder ? finder(text, mode, limit) : null;
    },
  };
}
