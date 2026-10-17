// @ts-check
// The Laboratory's exchanges with the server (server/features/lab/).
import { request } from '../../lib/api.js';

/**
 * @typedef {{ id: string, title: string, size: string, downloaded: boolean, done: number, total: number, running: boolean, rate: number, error: string | null }} Model
 * @typedef {{ id: number, text: string, createdAt: string, good: number, bad: number, open: number }} Question
 * good, bad, open: of the paragraphs its columns answered — judged answering, not, not yet judged
 * @typedef {{ col: string, asked: number, good: number, bad: number, open: number, top3: number, answered: number }} Score
 * a column's score over the questions it was asked: hits, misses, not judged; questions with a hit among its first three, at all
 * @typedef {{ installed: boolean, engineRunning: boolean, models: Model[], questions: Question[], score: Score[] }} Status
 * @typedef {{ ref: string, ru: string, en: string, paperTitle: string, score?: number, lang?: 'ru' | 'en' }} Found
 * @typedef {{ id: string, title: string, ms?: number, found: Found[] } | { id: string, title: string, error: string }} Column
 * @typedef {{ text: string, columns: Column[], judged: Record<string, boolean> }} Answer
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
  /** A paragraph answers the question (true), not (false), not judged (null) — in every column. @param {{ question: string, ref: string, good: boolean | null }} b @returns {Promise<Status>} */
  judge: (b) => request('POST', '/api/lab/judged', b),
  /** @param {number} id @returns {Promise<Status>} */
  removeQuestion: (id) => request('DELETE', `/api/lab/questions/${id}`),
};
