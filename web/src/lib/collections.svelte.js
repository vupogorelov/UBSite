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
