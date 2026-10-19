// @ts-check
// The Laboratory's exchanges with the server (server/features/lab/).
import { request } from '../../lib/api.js';

/**
 * @typedef {{ id: string, title: string, size: string, downloaded: boolean, done: number, total: number, running: boolean, queued: boolean, rate: number, error: string | null, gpu: boolean, device: 'cpu' | 'gpu', threads: number | null }} Model
 * gpu: can work on the video card; device: where it works now; threads: the processor's threads it has while at work
 * @typedef {{ threads: number, maxThreads: number, gpu: boolean, together: boolean }} Settings
 * how the vectors are worked out: the processor's threads (shared by the models on it), the video card, all models at once
 * @typedef {{ id: number, text: string, createdAt: string, good: number, bad: number, open: number }} Question
 * good, bad, open: of the paragraphs its columns answered — judged answering, not, not yet judged
 * @typedef {{ col: string, asked: number, good: number, bad: number, open: number, top3: number, answered: number }} Score
 * a column's score over the questions it was asked: hits, misses, not judged; questions with a hit among its first three, at all
 * @typedef {{ installed: boolean, engineRunning: boolean, settings: Settings, models: Model[], questions: Question[], score: Score[] }} Status
 * @typedef {{ ref: string, ru: string, en: string, paperTitle: string, score?: number, lang?: 'ru' | 'en' }} Found
 * @typedef {{ id: string, title: string, ms?: number, found: Found[] } | { id: string, title: string, error: string }} Column
 * @typedef {{ text: string, columns: Column[], judged: Record<string, boolean> }} Answer
 * @typedef {{ question: string, items: (Found & { by: { col: string, rank: number }[] })[] }} Todo
 * a question's paragraphs nobody judged yet: each once, who found it at which place
 */

export const labApi = {
  /** @returns {Promise<Status>} */
  status: () => request('GET', '/api/lab'),
  /** @param {string} id @returns {Promise<Status>} */
  run: (id) => request('POST', `/api/lab/models/${id}/run`),
  /** Every model not worked out to the end. @returns {Promise<Status>} */
  runAll: () => request('POST', '/api/lab/run-all'),
  /** One model's work paused, or every model's. @param {string} [id] @returns {Promise<Status>} */
  pause: (id) => request('POST', id ? `/api/lab/models/${id}/pause` : '/api/lab/pause'),
  /** @param {Partial<Pick<Settings, 'threads' | 'gpu' | 'together'>>} b @returns {Promise<Status>} */
  configure: (b) => request('POST', '/api/lab/settings', b),
  /** @param {string} text @returns {Promise<Answer>} */
  ask: (text) => request('POST', '/api/lab/ask', { text }),
  /** @param {string} text @returns {Promise<Status>} */
  addQuestion: (text) => request('POST', '/api/lab/questions', { text }),
  /** A paragraph answers the question (true), not (false), not judged (null) — in every column. @param {{ question: string, ref: string, good: boolean | null }} b @returns {Promise<Status>} */
  judge: (b) => request('POST', '/api/lab/judged', b),
  /** @returns {Promise<Todo[]>} */
  todo: () => request('GET', '/api/lab/todo'),
  /** The judgements of the Book's answers in one's «Я и Книга»: message id → hit. @returns {Promise<Record<number, boolean>>} */
  bookJudged: () => request('GET', '/api/lab/book-judged'),
  /** A Book's answer judged (its paragraph for the question it answers). @param {number} id @param {boolean | null} good */
  judgeBook: (id, good) => request('POST', '/api/lab/book-judged', { id, good }),
  /** @param {number} id @returns {Promise<Status>} */
  removeQuestion: (id) => request('DELETE', `/api/lab/questions/${id}`),
};
