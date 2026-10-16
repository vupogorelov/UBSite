// @ts-check
// One exchange with the server: the device's outgoing queue (TODO.md "Без сети", step 3).
//
// Every change the app makes goes through api.js → `send` here. What can wait (RULES, mode 'queue') is
// written to the queue on the device (IndexedDB, kept across closing the app) and sent in order — at
// once with a network, later without one. Each change carries its own id (X-Op-Id): the server does it
// once however many times it arrives (server/ops.js), so a change sent again after a broken connection
// is not doubled. A change that needs the server at the moment (sign-in, administration, votes…) is
// sent directly and, without a network, says so. "Печатает…" and activity beats are not kept at all.
// Which is which: shared/api-policy.js.
//
// A queued change's promise settles when it is sent (perhaps much later): the places that show the
// change at once (a message with its clock) do not wait for it. Refused by the server (no rights, not
// found): the promise is rejected and the change stays, marked failed — shown where it belongs (a
// message with "!") and in "Ждут отправки", to be tried again or given up.

import { log } from './log.js';
import { writePolicy } from '../../../shared/api-policy.js';

/** @typedef {import('../../../shared/api-policy.js').Kind} Kind */
/**
 * @typedef {{
 *   seq?: number, id: string, user: number, method: string, url: string, body: unknown, kind: Kind,
 *   at: string, state: 'wait' | 'failed', error?: string, tries: number
 * }} Op
 */

/**
 * What a change does without a network (shared/api-policy.js — one list for the app): it waits here
 * ('queue'), means nothing later ('drop') or needs the server now ('direct').
 * @param {string} method @param {string} url
 */
export const policyFor = (method, url) => writePolicy(method, url.split('?')[0]);

export const outbox = $state({
  /** The person's changes waiting to be sent or refused (in order). @type {Op[]} */
  items: /** @type {Op[]} */ ([]),
});

/** Set by api.js: a 401 shows the sign-in form. */
export const outboxHooks = { unauthorized: () => {} };

// ---- The queue on the device (IndexedDB) ----

/** @type {Promise<IDBDatabase> | null} */
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('ub-outbox', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
/** @template T @param {'readonly' | 'readwrite'} mode @param {(s: IDBObjectStore) => IDBRequest<T>} fn @returns {Promise<T>} */
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction('ops', mode).objectStore('ops'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const all = () => tx('readonly', (s) => /** @type {IDBRequest<Op[]>} */ (s.getAll()));
const put = (/** @type {Op} */ op) => tx('readwrite', (s) => s.put(op));
const del = (/** @type {number} */ seq) => tx('readwrite', (s) => s.delete(seq));

/** The person whose changes are sent (session.svelte.js sets it). */
let me = 0;

async function refresh() {
  try {
    outbox.items = (await all()).filter((o) => o.user === me);
    dispatchEvent(new CustomEvent('ub-outbox')); // (sections lay what still waits over what the server knows)
  } catch {}
}

// ---- Sending ----

/** Those waiting for a change's answer in this tab. @type {Map<string, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
const waiters = new Map();
/** The change being sent now (not merged with). */
let sending = '';

/** A new id made on the device (a change's; a note's own). */
export const uuid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Queues a change and sends it as soon as it can. Settles with the server's answer when sent.
 * @param {string} method @param {string} url @param {unknown} body
 * @param {{ kind: Kind, merge?: 'replace' | 'patch' }} policy the change's ('queue')
 * @returns {Promise<any>}
 */
export async function enqueue(method, url, body, policy) {
  const { kind, merge } = policy;
  /** @type {Op} */
  const op = { id: uuid(), user: me, method, url, body, kind, at: new Date().toISOString(), state: 'wait', tries: 0 };
  if (kind === 'message' && body && typeof body === 'object') op.body = { ...body, writtenAt: op.at }; // (the time it was written)
  if (merge) {
    for (const old of await all()) {
      if (old.user !== me || old.state !== 'wait' || old.method !== method || old.url !== url || old.id === sending) continue;
      if (merge === 'patch') op.body = { .../** @type {object} */ (old.body), .../** @type {object} */ (op.body) };
      await del(/** @type {number} */ (old.seq));
      waiters.get(old.id)?.resolve(undefined); // (the newer change carries it)
      waiters.delete(old.id);
    }
  }
  const p = new Promise((resolve, reject) => waiters.set(op.id, { resolve, reject }));
  await put(op);
  await refresh();
  void drain();
  return p;
}

/** A change in words ("Сообщение: «Добрый вечер…»"). @param {Op} op */
export function describe(op) {
  const b = /** @type {any} */ (op.body);
  if (op.kind === 'message') {
    const text = String(b?.body ?? '').replace(/\s+/g, ' ').trim();
    return `Сообщение: «${text.length > 40 ? text.slice(0, 40) + '…' : text}»`;
  }
  if (op.kind === 'note') {
    const ref = b?.ref ? ` · ${b.ref}` : '';
    if (op.url.endsWith('/comments') && op.method === 'POST') {
      const text = String(b?.body ?? '').replace(/\s+/g, ' ').trim();
      return `Комментарий: «${text.length > 40 ? text.slice(0, 40) + '…' : text}»`;
    }
    if (op.method === 'POST') return `${b?.bookmark || b?.color ? 'Новая закладка' : 'Новая заметка'}${ref}`;
    if (op.method === 'DELETE') return op.url.includes('/comments/') ? 'Удаление комментария' : 'Удаление заметки';
    if (op.url.endsWith('/tags')) return 'Метки заметки';
    return 'Изменение заметки';
  }
  if (op.kind === 'task') {
    if (op.url === '/api/tasks' && op.method === 'POST') return `Новая задача: «${String(b?.title ?? '').slice(0, 40)}»`;
    if (op.url.endsWith('/order')) return 'Порядок задач';
    if (op.url.includes('/subtasks')) return op.method === 'POST' ? `Подзадача: «${String(b?.title ?? '').slice(0, 40)}»` : 'Изменение подзадачи';
    return op.method === 'DELETE' ? 'Удаление задачи' : 'Изменение задачи';
  }
  return {
    read: 'Отметка «прочитано»', mute: 'Звук чата', pinned: 'Закреплённые чаты', settings: 'Настройки', history: 'История поиска',
    react: `Реакция ${b?.emoji ?? ''}`.trim(), mark: 'Пометка сообщения', pin: 'Закреплённое сообщение', follow: 'Подписка на обсуждение',
  }[op.kind] ?? 'Изменение';
}

/**
 * Rewrites a change not sent yet (a subtask ticked before it reached the server: its creation carries
 * the tick). False if it is being sent or gone — then it is a change of its own. @param {Op} op @param {unknown} body
 */
export async function amend(op, body) {
  const cur = (await all()).find((o) => o.id === op.id);
  if (!cur || cur.state !== 'wait' || cur.id === sending) return false;
  await put({ ...cur, body });
  await refresh();
  return true;
}

/** The change as it is shown before it is sent: its id in the queue. @param {string} url */
export const waitingFor = (url) => outbox.items.filter((o) => o.url === url);

let draining = false;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let retryTimer;

/** Sends what waits, in order; stops at a missing network (and tries again later). */
export async function drain() {
  if (draining || !me) return;
  draining = true;
  clearTimeout(retryTimer);
  try {
    const run = async () => {
      for (;;) {
        const op = (await all()).find((o) => o.user === me && o.state === 'wait');
        if (!op) return;
        const r = await attempt(op);
        if (r === 'retry') {
          // a growing pause: 2 s, 4 s … up to a minute (and at once when the network is back)
          retryTimer = setTimeout(drain, Math.min(60_000, 2000 * 2 ** Math.min(op.tries, 5)));
          return;
        }
        if (r === 'auth') return; // (after signing in again)
      }
    };
    // one tab sends (another would send the same changes)
    if (navigator.locks) await navigator.locks.request('ub-outbox', run);
    else await run();
  } finally {
    draining = false;
    await refresh();
  }
}

/** @param {Op} op @returns {Promise<'next' | 'retry' | 'auth'>} */
async function attempt(op) {
  sending = op.id;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  /** @type {Response} */
  let res;
  try {
    res = await fetch(op.url, {
      method: op.method,
      headers: { 'Content-Type': 'application/json', 'X-Op-Id': op.id },
      body: JSON.stringify(op.body ?? null),
      signal: ctl.signal,
    });
  } catch {
    if (op.tries === 0 && navigator.onLine !== false) log('queue', `${op.kind}: нет связи — ждёт`, undefined, 'warn');
    op.tries++;
    await put(op);
    return 'retry';
  } finally {
    clearTimeout(timer);
    sending = '';
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    outboxHooks.unauthorized();
    return 'auth';
  }
  if (res.status >= 500) {
    log('queue', `${op.kind}: сбой сервера`, { status: res.status, tries: op.tries }, 'error');
    op.tries++;
    await put(op);
    return 'retry';
  }
  const w = waiters.get(op.id);
  waiters.delete(op.id);
  if (res.ok) {
    // (how long it waited: written without a network and sent later)
    log('queue', `${op.kind}: отправлено`, { waited: Math.round((Date.now() - Date.parse(op.at)) / 1000), tries: op.tries });
    await del(/** @type {number} */ (op.seq));
    outbox.items = outbox.items.filter((o) => o.id !== op.id); // (gone from view as its answer takes its place)
    w?.resolve(data);
    dispatchEvent(new CustomEvent('ub-sent', { detail: { op, data } }));
  } else {
    // refused: kept, marked — shown where it belongs ("!" on a message) and in "Ждут отправки", with
    // «Повторить» / «Удалить»; nothing a person wrote disappears silently
    const err = Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { status: res.status });
    log('queue', `${op.kind}: не принято`, { status: res.status, error: err.message, path: op.url.replace(/\d+/g, '#') }, 'warn');
    await put({ ...op, state: 'failed', error: err.message });
    w?.reject(err);
  }
  return 'next';
}

/** Tries a refused change again. @param {Op} op */
export async function retry(op) {
  await put({ ...op, state: 'wait', error: undefined, tries: 0 });
  await refresh();
  void drain();
}

/** Gives a change up (not sent). @param {Op} op */
export async function discard(op) {
  if (op.seq !== undefined) await del(op.seq);
  waiters.get(op.id)?.reject(Object.assign(new Error('Отменено'), { status: 0 }));
  waiters.delete(op.id);
  await refresh();
}

/** Signed in (or out: 0): this person's changes are shown and sent. @param {number} userId */
export function setOutboxUser(userId) {
  me = userId;
  void refresh().then(drain);
}

if (typeof window !== 'undefined') {
  addEventListener('online', () => void drain());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void drain());
}
