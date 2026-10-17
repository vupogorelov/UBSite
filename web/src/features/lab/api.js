// @ts-check
// The Laboratory's exchanges with the server (server/features/lab/).
import { request } from '../../lib/api.js';

/**
 * @typedef {{ id: string, title: string, size: string, downloaded: boolean, done: number, total: number, running: boolean, rate: number, error: string | null }} Model
 * @typedef {{ installed: boolean, engineRunning: boolean, models: Model[], questions: { id: number, text: string, createdAt: string, good: number, bad: number }[],
 *   score: { model: string, good: number, bad: number, answered: number }[] }} Status
 * score: per model ('words' — the word search) its hits, misses, and the questions it answered (a hit among its answers)
 * @typedef {{ ref: string, ru: string, en: string, paperTitle: string, score?: number, lang?: 'ru' | 'en' }} Found
 * @typedef {{ text: string, models: Record<string, { ms: number, found: Found[] } | { error: string }>, words: Found[], marks: Record<string, Record<string, boolean>> }} Answer
 */

export const labApi = {
  /** @returns {Promise<Status>} */
  status: () => request('GET', '/api/lab'),
  /** @param {string} id @returns {Promise<Status>} */
  run: (id) => request('POST', `/api/lab/models/${id}/run`),
  /** @returns {Promise<Status>} */
  pause: () => request('POST', '/api/lab/pause'),
  /** @param {string} text @returns {Promise<Answer>} */
  ask: (text) => request('POST', '/api/lab/ask', { text }),
  /** @param {string} text @returns {Promise<Status>} */
  addQuestion: (text) => request('POST', '/api/lab/questions', { text }),
  /** A found paragraph: hit (true), missed (false), unmarked (null). @param {{ question: string, model: string, ref: string, good: boolean | null }} b @returns {Promise<Status>} */
  mark: (b) => request('POST', '/api/lab/marks', b),
  /** @param {number} id @returns {Promise<Status>} */
  removeQuestion: (id) => request('DELETE', `/api/lab/questions/${id}`),
};
