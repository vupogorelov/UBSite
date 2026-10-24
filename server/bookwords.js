// @ts-check
// «Я и Книга» in the Book's own words (VISION.md: the Book a participant), by a remote AI (server/ai.js) from the
// paragraphs found (server/reply.js: from them alone, each thought with its number): the reader's own connection
// first — no limit of ours; else the application's shared answers of the day; else none — the paragraphs answer
// alone, as before. Free models only.
import { langOf, messagesFor, MAX_TOKENS, RULES } from './reply.js';

/** How long a reader's own rules may be (characters): room for a page of wishes, not for a book. */
export const RULES_MAX = 4000;

/**
 * The models the Book writes with, in turn — another when one is busy or failing at its source (free models share
 * their source's pool, and come and go). Free ones of OpenRouter. Tried 2026-10-22: Nemotron 3 Ultra — the finer
 * reading (≈7–50 s, sometimes overloaded); Nemotron 3.5 Super — as good (≈30 s); Google's Gemma 4 — often busy;
 * gone or unfit: MiniMax M3.1 Flash (free no more), Nemotron 3 Super (not served), Nemotron 3.5 Lightning (thinks
 * past its room), Inkling (refused).
 */
export const BOOK_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];
/** All busy: once more after this, the whole list again. */
const AGAIN_AFTER = 3000;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('./ai.js').createAi>} ai
 */
export function createBookWords(db, ai) {
  const paragraph = db.prepare('SELECT plain_ru AS ru, plain_en AS en FROM paragraphs WHERE ref = ?');
  const ownRules = db.prepare('SELECT rules FROM ai_rules WHERE user_id = ?');
  const keepRules = db.prepare('INSERT INTO ai_rules (user_id, rules) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET rules = excluded.rules');
  const dropRules = db.prepare('DELETE FROM ai_rules WHERE user_id = ?');
  /** A reader's own rules, or null — the default ones. @param {number} userId @returns {string | null} */
  const rulesOf = (userId) => /** @type {{ rules: string } | undefined} */ (ownRules.get(userId))?.rules ?? null;

  /**
   * The answer through an owner's connection, by the first model that serves — all busy: the list once more a moment
   * later. The day's limit reached or the key refused — another model would not help: said at once.
   * @param {string} owner @param {{ role: string, content: string }[]} messages
   */
  async function ask(owner, messages) {
    /** @type {string[]} */
    const why = [];
    for (let round = 0; round < 2; round++) {
      if (round) await new Promise((r) => setTimeout(r, AGAIN_AFTER));
      for (const model of BOOK_MODELS) {
        try {
          return (await ai.chat(owner, model, messages, { max: MAX_TOKENS * 4 })).text;
        } catch (err) {
          const e = /** @type {any} */ (err);
          if (e.status === 429 || e.status === 409) throw err;
          why.push(`${model}: ${e.message}`);
        }
      }
    }
    throw new Error(`Ни одна модель не ответила — ${why.join('; ')}`);
  }

  return {
    /**
     * The Book's own words for a reader's question from the paragraphs found (server/bookvoice.js: its Writer), or
     * null — no AI for this reader now.
     * @param {string} question @param {string[]} refs @param {number} ownerId
     * @param {{ role: 'user' | 'assistant', content: string }[]} [history] the conversation so far (server/bookvoice.js)
     */
    async write(question, refs, ownerId, history = []) {
      const lang = langOf(question);
      const paragraphs = refs
        .map((ref) => ({ ref, text: /** @type {Record<string, string> | undefined} */ (paragraph.get(ref))?.[lang] ?? '' }))
        .filter((p) => p.text);
      if (!paragraphs.length) return null;
      const messages = messagesFor(question, paragraphs, history, rulesOf(ownerId));
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

    /**
     * How the AI answers this reader: the rules it is given, the default ones, and whether these are their own.
     * @param {number} userId
     */
    rules(userId) {
      const own = rulesOf(userId);
      return { rules: own ?? RULES.ru, default: RULES.ru, own: own !== null };
    },

    /**
     * A reader's own rules kept; empty or the same as the default — the default again.
     * @param {number} userId @param {string} text
     */
    setRules(userId, text) {
      const t = text.replace(/\r\n?/g, '\n').trim().slice(0, RULES_MAX);
      if (!t || t === RULES.ru.trim()) dropRules.run(userId);
      else keepRules.run(userId, t);
      return this.rules(userId);
    },
  };
}
