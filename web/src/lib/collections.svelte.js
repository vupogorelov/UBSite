// @ts-check
// Collections ("подборки") of the current workspace: the list, the open one, adding to them.
import { api, current } from './api.js';
import { showToast } from './toast.svelte.js';

export const collections = $state({
  /** @type {import('./api.js').Collection[]} */ own: [],
  /** @type {import('./api.js').Collection[]} */ subscribed: [],
  /** Workspace the lists belong to. @type {number | null} */ ws: null,
  /** Collection open in the side panel. @type {number | null} */ openId: null,
  /** The last collection something was added to: offered first. @type {number | null} */ lastId: null,
  /** Incremented on every change, so open views reload. */ version: 0,
});

export async function loadCollections(force = false) {
  if (!force && collections.ws === current.ws) return;
  try {
    const r = await api.collections();
    collections.own = r.own;
    collections.subscribed = r.subscribed;
    collections.ws = current.ws;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
  }
}

// ---- Every collection readable without a network (TODO.md "Без сети", 3.4) ----
// The workspace's collections and those subscribed to are fetched quietly in the background — the
// service worker keeps each answer (public/sw.js, "ub-last"), so a collection never opened here reads
// without a network too. Fetched again only when changed (its updatedAt). Changing a collection needs
// the network: it is shared by many, and changes without a network are not offered (an honest message).

const KEPT_KEY = 'ub.keptCollections';
let keeping = false;
/** Fetches what changed among the workspace's collections (with a network; quietly). @param {number} ws */
export async function keepCollections(ws) {
  if (keeping || navigator.onLine === false) return;
  keeping = true;
  try {
    /** @type {Record<string, string>} */
    let kept = {};
    try {
      kept = JSON.parse(localStorage.getItem(`${KEPT_KEY}.${ws}`) ?? '{}') ?? {};
    } catch {}
    const r = await fetch(`/api/workspaces/${ws}/collections`).then((x) => (x.ok ? x.json() : null));
    if (!r) return;
    /** @type {Record<string, string>} */
    const next = {};
    for (const c of [...r.own, ...r.subscribed]) {
      next[c.id] = c.updatedAt;
      if (kept[c.id] === c.updatedAt) continue;
      const ok = await fetch(`/api/collections/${c.id}`).then((x) => x.ok, () => false);
      if (!ok) delete next[c.id];
    }
    try {
      localStorage.setItem(`${KEPT_KEY}.${ws}`, JSON.stringify(next));
    } catch {}
  } catch {
  } finally {
    keeping = false;
  }
}
/** Signing out (the kept answers are cleared too): what was kept is forgotten, fetched anew next time. */
export function forgetKeptCollections() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(KEPT_KEY)) localStorage.removeItem(k);
  } catch {}
}
if (typeof window !== 'undefined') {
  addEventListener('online', () => void keepCollections(current.ws));
  setInterval(() => document.visibilityState === 'visible' && void keepCollections(current.ws), 10 * 60_000);
}

/** Runs a change, then reloads the lists. @template T @param {() => Promise<T>} fn @returns {Promise<T | null>} */
export async function changeCollections(fn) {
  try {
    const r = await fn();
    collections.version++;
    await loadCollections(true);
    return r;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
    return null;
  }
}

/** @param {string} title */
export const createCollection = (title) => changeCollections(() => api.createCollection(title));

/**
 * Adds an item to a collection (a new one when `id` is null, named `title`).
 * @param {number | null} id @param {import('./api.js').NewCollectionItem} item @param {string} [title]
 */
export async function addToCollection(id, item, title) {
  let target = id;
  let name = collections.own.find((c) => c.id === id)?.title ?? '';
  if (target === null) {
    const created = await createCollection(title || 'Новая подборка');
    if (!created) return false;
    target = created.id;
    name = created.title;
  }
  const cid = target;
  const ok = await changeCollections(() => api.addCollectionItem(cid, item));
  if (ok) {
    collections.lastId = cid;
    showToast(`Добавлено в подборку «${name}»`);
  }
  return !!ok;
}
