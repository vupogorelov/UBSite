// @ts-check
// The feed of changes on the device (TODO.md "Без сети", step 3): one incoming side, as the outgoing
// queue (outbox.svelte.js) is one outgoing side. A person's data is kept here (IndexedDB) whole — not
// only what was seen — and brought up to date by asking the server "what changed after N?" (written by
// triggers on the server, so nothing is missed): at start, when the network is back, when the app is
// shown again, once a minute while it is in view, and when something moves live. Other devices' changes
// so arrive without a reload; without a network what is kept is shown.
//
// Two feeds now: the workspace's notes (…/workspaces/:id/changes) and the person's tasks
// (/api/tasks/changes). Each tells its section by its own event ("ub-feed", "ub-feed-tasks").

/** @typedef {{ id: number }} Item */
/** @typedef {{ key: string, seq: number | null, items: Item[] }} Space */

import { log } from './log.js';

/** @type {Promise<IDBDatabase> | null} */
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('ub-feed', 2);
    r.onupgradeneeded = () => {
      if (r.result.objectStoreNames.contains('spaces')) r.result.deleteObjectStore('spaces'); // (version 1 kept { notes }: fetched anew)
      r.result.createObjectStore('spaces', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
/** @param {string} key @returns {Promise<Space | undefined>} */
async function read(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('spaces').objectStore('spaces').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
/** @param {Space} s */
async function write(s) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('spaces', 'readwrite').objectStore('spaces').put(JSON.parse(JSON.stringify(s)));
    r.onsuccess = () => resolve(undefined);
    r.onerror = () => reject(r.error);
  });
}

/**
 * A feed: what one part of a person's data is on this device.
 * @template {Item} T
 * @param {{ event: string, field: string, what: string }} o `field`: the list in the server's answer
 */
function createFeed(o) {
  /** @type {Space} */
  let space = { key: '', seq: null, items: [] };
  let url = '';
  let ready = Promise.resolve();
  const changed = () => dispatchEvent(new CustomEvent(o.event));

  /** @type {Promise<void> | null} */
  let pulling = null;
  let again = false;
  function pull() {
    if (!space.key) return Promise.resolve();
    if (pulling) {
      again = true;
      return pulling;
    }
    pulling = (async () => {
      const key = space.key;
      const since = space.seq;
      try {
        const res = await fetch(`${url}${since === null ? '' : `?since=${since}`}`, { cache: 'no-store' });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        /** @type {{ seq: number, reset: boolean, deleted: number[] } & Record<string, any>} */
        const f = await res.json();
        if (space.key !== key) return; // (another workspace or person meanwhile)
        /** @type {Item[]} */
        const fresh = f[o.field] ?? [];
        let items = f.reset ? [] : space.items;
        if (!f.reset && (fresh.length || f.deleted.length)) {
          const gone = new Set([...f.deleted, ...fresh.map((n) => n.id)]);
          items = items.filter((n) => !gone.has(n.id));
        }
        const moved = f.reset || fresh.length > 0 || f.deleted.length > 0;
        space = { key, seq: f.seq, items: [...items, ...fresh] };
        if (moved) {
          await write(space).catch(() => {});
          changed();
        } else if (since !== f.seq) void write(space).catch(() => {});
      } catch (err) {
        const status = /** @type {any} */ (err)?.status;
        if (status && navigator.onLine !== false) log('feed', `${o.what}: лента изменений не получена`, { status }, 'warn');
      } finally {
        pulling = null;
        if (again) {
          again = false;
          void pull();
        }
      }
    })();
    return pulling;
  }

  return {
    /** What is kept. @returns {T[]} */
    items: () => /** @type {T[]} */ (space.items),
    /** The kept items are read (for the first paint). */
    ready: () => ready,
    /** Opens a key (a workspace, a person): its kept items at once, then what changed. @param {string} key @param {string} from */
    open(key, from) {
      if (space.key === key) return ready;
      url = from;
      space = { key, seq: null, items: [] };
      ready = read(key)
        .then((kept) => {
          if (kept && space.key === key) {
            space = kept;
            changed();
          }
        })
        .catch(() => {});
      void ready.then(pull);
      return ready;
    },
    /** One item's new state from the server (one's own change answered). @param {T | { id: number, deleted: true }} res */
    apply(res) {
      const items = space.items.filter((n) => n.id !== res.id);
      if (!('deleted' in res)) items.push(res);
      space = { ...space, items };
      void write(space).catch(() => {});
      changed();
    },
    pull,
    /** Forgotten on this device (signing out). */
    forget() {
      space = { key: '', seq: null, items: [] };
    },
  };
}

/** The open workspace's notes. @type {ReturnType<typeof createFeed<import('./api.js').Note>>} */
export const notesFeed = createFeed({ event: 'ub-feed', field: 'notes', what: 'заметки' });
/** The person's tasks (theirs in every workspace). @type {ReturnType<typeof createFeed<import('./api.js').Task>>} */
export const tasksFeed = createFeed({ event: 'ub-feed-tasks', field: 'tasks', what: 'задачи' });

// The notes' names as before (notes.svelte.js, the panels).
export const feedNotes = () => notesFeed.items();
export const feedReady = () => notesFeed.ready();
/** @param {import('./api.js').NoteResult} res */
export const feedApply = (res) => notesFeed.apply(/** @type {any} */ (res));
export const pull = () => notesFeed.pull();

/** A workspace is opened (sign-in, a switch): its notes, and the person's tasks. @param {number} user @param {number} workspace */
export function openFeed(user, workspace) {
  void tasksFeed.open(`${user}:tasks`, '/api/tasks/changes');
  return notesFeed.open(`${user}:${workspace}`, `/api/workspaces/${workspace}/changes`);
}

/** Signing out: what is kept on this device is forgotten. */
export async function forgetFeed() {
  notesFeed.forget();
  tasksFeed.forget();
  try {
    (await dbp)?.close();
  } catch {}
  dbp = null;
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('ub-feed');
    r.onsuccess = r.onerror = r.onblocked = () => resolve(undefined);
  });
}

if (typeof window !== 'undefined') {
  const both = () => {
    void notesFeed.pull();
    void tasksFeed.pull();
  };
  addEventListener('online', both);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && both());
  setInterval(() => document.visibilityState === 'visible' && both(), 60_000);
}
