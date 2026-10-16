// @ts-check
// The dictionary of names on the client: loaded once, edited by coordinators (Настройки → Текст → Словарь
// названий); shown in the reader's text when "Названия по смыслу" is on (shared/aliases.js).
import { api } from './api.js';
import { showToast } from './toast.svelte.js';

/** @type {{ list: import('./api.js').NameAlias[], loaded: boolean }} */
export const aliases = $state({ list: [], loaded: false });
let loading = false;

export async function loadAliases(force = false) {
  if ((aliases.loaded || loading) && !force) return;
  loading = true;
  try {
    aliases.list = await api.aliases();
    aliases.loaded = true;
  } catch {
    // (no dictionary — no names changed)
  } finally {
    loading = false;
  }
}

/** @template T @param {() => Promise<T>} fn */
async function change(fn) {
  try {
    const r = await fn();
    await loadAliases(true);
    return r ?? true;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
    return null;
  }
}
/** @param {Omit<import('./api.js').NameAlias, 'id'>} a */
export const addAlias = (a) => change(() => api.createAlias(a));
/** @param {number} id @param {Omit<import('./api.js').NameAlias, 'id'>} a */
export const updateAlias = (id, a) => change(() => api.updateAlias(id, a));
/** @param {number} id */
export const deleteAlias = (id) => change(() => api.deleteAlias(id));
