// @ts-check
// Runs search requests one at a time in a worker thread with a time limit.
import { Worker } from 'node:worker_threads';
import { HttpError } from '../http.js';

const TIMEOUT_MS = Number(process.env.UB_SEARCH_TIMEOUT_MS ?? 3000);

/**
 * @typedef {{ op: 'search', text: string, offset: number, limit: number, ws: number }
 *   | { op: 'highlights', text: string, paper: number, ws: number }} SearchRequest
 * @typedef {{ msg: SearchRequest, resolve: (v: any) => void, reject: (e: Error) => void }} Job
 */

export function createSearchClient() {
  /** @type {Worker} */
  let worker;
  let ready = false;
  /** @type {Job[]} */
  const queue = [];
  /** @type {(Job & { id: number, timer: ReturnType<typeof setTimeout> }) | null} */
  let running = null;
  let nextId = 1;

  function start() {
    ready = false;
    worker = new Worker(new URL('./worker.js', import.meta.url));
    worker.on('message', (m) => {
      if (m.ready) {
        ready = true;
        pump();
        return;
      }
      if (!running || m.id !== running.id) return;
      const job = running;
      running = null;
      clearTimeout(job.timer);
      if (m.error) job.reject(new HttpError(m.error.query ? 400 : 500, m.error.message));
      else job.resolve(m.result);
      pump();
    });
    worker.on('error', (err) => {
      console.error('Search worker failed:', err);
      restart(new HttpError(500, 'Ошибка поиска'));
    });
  }

  /** @param {Error} reason */
  function restart(reason) {
    if (running) {
      clearTimeout(running.timer);
      running.reject(reason);
      running = null;
    }
    worker.removeAllListeners();
    worker.terminate();
    start();
  }

  function pump() {
    if (!ready || running || !queue.length) return;
    const job = /** @type {Job} */ (queue.shift());
    const id = nextId++;
    const timer = setTimeout(() => {
      console.warn(`Search stopped after ${TIMEOUT_MS} ms: ${job.msg.text}`);
      restart(new HttpError(400, 'Запрос выполнялся слишком долго и был остановлен — вероятно, регулярное выражение слишком «тяжёлое»'));
    }, TIMEOUT_MS);
    running = { ...job, id, timer };
    worker.postMessage({ ...job.msg, id });
  }

  start();

  return {
    /** @param {SearchRequest} msg */
    run(msg) {
      return new Promise((resolve, reject) => {
        queue.push({ msg, resolve, reject });
        pump();
      });
    },
    close() {
      worker.terminate();
    },
  };
}
