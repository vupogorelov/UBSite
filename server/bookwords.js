// @ts-check
// «Я и Книга» in the Book's own words (VISION.md: the Book a participant), by a remote AI (server/ai.js) from the
// paragraphs found (server/reply.js: from them alone, each thought with its number): the reader's own connection
// first — no limit of ours; else the application's shared answers of the day; else none — the paragraphs answer
// alone, as before. Free models only.
import { langOf, messagesFor, MAX_TOKENS } from './reply.js';

/**
 * The models the Book writes with, in turn — another when one is busy or failing at its source (free models share
 * their source's pool: Google's Gemma is often busy). Free ones of OpenRouter. Tried 2026-10-22: Nemotron 3 Ultra —
 * the finer reading (≈7 s); MiniMax M3.1 Flash — the quickest (≈3 s), plainer; Nemotron 3 Super — not served.
 */
export const BOOK_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'minimax/minimax-m3.1-flash:free',
  'google/gemma-4-26b-a4b-it:free',
];

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('./ai.js').createAi>} ai
 */
export function createBookWords(db, ai) {
  const paragraph = db.prepare('SELECT plain_ru AS ru, plain_en AS en FROM paragraphs WHERE ref = ?');

  /**
   * The answer through an owner's connection, by the first model that serves. The limit reached or no access —
   * another model would not help: said at once. @param {string} owner @param {{ role: string, content: string }[]} messages
   */
  async function ask(owner, messages) {
    /** @type {any} */
    let last = null;
    for (const model of BOOK_MODELS) {
      try {
        return (await ai.chat(owner, model, messages, { max: MAX_TOKENS * 4 })).text;
      } catch (err) {
        last = err;
        if (/** @type {any} */ (err).status === 429 || /** @type {any} */ (err).status === 409) break;
      }
    }
    throw last;
  }

  return {
    /**
     * The Book's own words for a reader's question from the paragraphs found (server/bookvoice.js: its Writer), or
     * null — no AI for this reader now.
     * @param {string} question @param {string[]} refs @param {number} ownerId
     */
    async write(question, refs, ownerId) {
      const lang = langOf(question);
      const paragraphs = refs
        .map((ref) => ({ ref, text: /** @type {Record<string, string> | undefined} */ (paragraph.get(ref))?.[lang] ?? '' }))
        .filter((p) => p.text);
      if (!paragraphs.length) return null;
      const messages = messagesFor(question, paragraphs);
      const own = `user:${ownerId}`;
      if (ai.status(own)) {
        try {
          return await ask(own, messages);
        } catch (err) {
          console.error('The reader\'s own AI did not answer, the shared one may:', /** @type {Error} */ (err).message);
        }
      }
      if (!ai.status('app') || !ai.takeShared()) return null;
      try {
        return await ask('app', messages);
      } catch (err) {
        if (/** @type {any} */ (err).status === 429) ai.spendShared();
        else ai.returnShared();
        throw err;
      }
    },

    /**
     * What a reader sees in «Я и Книга»: their own AI (or none), the shared answers left today (null — the
     * application has none connected). @param {number} userId
     */
    state(userId) {
      return { own: ai.status(`user:${userId}`), shared: ai.status('app') ? ai.shared() : null };
    },
  };
}
