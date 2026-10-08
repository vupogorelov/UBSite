// @ts-check
// Search engine in a worker thread: a catastrophic regular expression can only stall this
// thread, which the main thread then terminates and restarts (see client.js).
import { parentPort } from 'node:worker_threads';
import { openDb } from '../db.js';
import { createSearch } from './engine.js';
import { createTagStore } from '../tags.js';
import { QueryError } from './query.js';

const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);
const db = openDb();
const engine = createSearch(db);
const tags = createTagStore(db);

/**
 * @typedef {{ id: number, op: 'search', text: string, offset: number, limit: number, ws: number }
 *   | { id: number, op: 'highlights', text: string, paper: number, ws: number }} Request
 */

port.on('message', (/** @type {Request} */ msg) => {
  const ctx = { tagRefs: (/** @type {string} */ name) => tags.refsWith(msg.ws, name) };
  try {
    const result =
      msg.op === 'search' ? engine.search(msg.text, msg.offset, msg.limit, ctx) : engine.highlights(msg.text, msg.paper, ctx);
    port.postMessage({ id: msg.id, result });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    port.postMessage({ id: msg.id, error: { message: e.message, query: err instanceof QueryError } });
  }
});
port.postMessage({ ready: true });
