// @ts-check
// Search, its highlights and "go to" without a network: the server answers while it can; when the
// network fails, is silent for WAIT ms or the server errs, the device answers itself from the book it
// keeps (search.worker.js) — the same results, checked by scripts/check-offline.js.
// The device's word index is prepared ahead, quietly, while there is a network ("prepare" after the
// book is saved): without a network the first search is immediate too.
import { offline, searchKey, searchKept } from './offline.svelte.js';
import { log } from './log.js';

/** How long the server has before the device answers. */
const WAIT = 4000;
const SLOW = Symbol('slow');

/** @type {Worker | null} */
let worker = null;
let seq = 0;
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
const waiting = new Map();

/** The thread is gone (closed, or failed — e.g. out of memory on a phone): everyone waiting is told. */
function drop(/** @type {string} */ why) {
  worker?.terminate();
  worker = null;
  for (const w of waiting.values()) w.reject(new Error(why));
  waiting.clear();
}

/** @param {Record<string, unknown>} msg @returns {Promise<any>} */
function ask(msg) {
  if (!worker) {
    worker = new Worker(new URL('./search.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(Object.assign(new Error(e.data.error.message), { answer: e.data.error.answer }));
      else w.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      log('offline', 'поиск без сети упал', { error: e.message }, 'error');
      drop('Поиск без сети не запустился');
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    /** @type {Worker} */ (worker).postMessage({ id, key: searchKey(), ...msg });
  });
}

// Prepared ahead while there is a network, then the thread is closed (its memory is not kept for nothing).
let preparing = false;
addEventListener('ub-search-prepare', () => {
  if (preparing) return;
  preparing = true;
  const key = searchKey();
  setTimeout(() => {
    const t0 = performance.now();
    ask({ op: 'prepare' })
      .then(() => {
        searchKept(key);
        log('offline', 'поиск без сети подготовлен', { ms: Math.round(performance.now() - t0) });
      })
      .catch((err) => log('offline', 'поиск без сети не подготовился', { error: err.message }, 'warn'))
      .finally(() => {
        preparing = false;
        if (navigator.onLine !== false && !waiting.size) drop('');
      });
  }, 5000); // (after the page itself has settled)
});
// Back online: the server searches again, the thread's memory is given back.
addEventListener('online', () => {
  if (!waiting.size && !preparing) drop('');
});

// No network: the device's search gets ready at once (reading what was prepared).
function warm() {
  if (offline.state === 'ready') ask({ op: 'prepare' }).catch(() => {});
}
addEventListener('offline', warm);
if (navigator.onLine === false) setTimeout(warm, 1500);

/**
 * The server's answer, or the device's when the server cannot give it. An answer of the server's
 * own (a mistake in the query, "not found") is kept as it is.
 * @template T @param {() => Promise<T>} online @param {Record<string, unknown>} msg @returns {Promise<T>}
 */
export async function orOnDevice(online, msg) {
  if (offline.state !== 'ready') return online();
  if (navigator.onLine === false) return ask(msg);
  const net = online();
  net.catch(() => {}); // (answered by the device meanwhile: a late failure of the network is nobody's concern)
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([net, new Promise((_, reject) => (timer = setTimeout(() => reject(SLOW), WAIT)))]);
  } catch (err) {
    const status = /** @type {any} */ (err)?.status;
    if (status && status < 500) throw err;
    try {
      return await ask(msg);
    } catch (local) {
      if (/** @type {any} */ (local).answer) throw local; // (the device's own answer: a mistake in the query, "not found")
      if (err === SLOW) return net; // (the book could not be read here: the server is waited for)
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}
