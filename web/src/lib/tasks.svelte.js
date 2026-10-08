// @ts-check
// Personal tasks: the user's lists and tasks (loaded once, kept in sync after every change).
import { api } from './api.js';
import { showToast } from './toast.svelte.js';
import { notify } from './notify.svelte.js';

/** @typedef {import('./api.js').Task} Task */

export const tasks = $state({
  /** @type {import('./api.js').TaskList[]} */ lists: [],
  /** @type {Task[]} */ items: [],
  loaded: false,
});

/** The user's calendar day, YYYY-MM-DD. @param {number} [plusDays] */
export function today(plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Recounts "due today or overdue" for the top bar from the loaded tasks. */
function recount() {
  const t = today();
  notify.tasksDue = tasks.items.filter((x) => x.status !== 'done' && x.due !== null && x.due <= t).length;
}

export async function loadTasks(force = false) {
  if (tasks.loaded && !force) return;
  try {
    const r = await api.tasks();
    tasks.lists = r.lists;
    tasks.items = r.tasks;
    tasks.loaded = true;
    recount();
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
  }
}

/** Puts a task returned by the server into the store. @param {Task} t */
function put(t) {
  const i = tasks.items.findIndex((x) => x.id === t.id);
  if (i < 0) tasks.items.unshift(t);
  else tasks.items[i] = t;
  recount();
  return t;
}

/** @template T @param {() => Promise<T>} fn @returns {Promise<T | null>} */
async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
    return null;
  }
}

/** @param {import('./api.js').TaskPatch & { title: string }} fields */
export async function createTask(fields) {
  await loadTasks();
  const t = await attempt(() => api.createTask(fields));
  return t && put(t);
}
/** @param {number} id @param {import('./api.js').TaskPatch} patch */
export async function patchTask(id, patch) {
  const t = await attempt(() => api.patchTask(id, patch));
  return t && put(t);
}
/** @param {number} id */
export async function deleteTask(id) {
  if ((await attempt(() => api.deleteTask(id))) === null) return;
  tasks.items = tasks.items.filter((x) => x.id !== id);
  recount();
}
/** @param {number} id @param {string} title */
export const addSubtask = async (id, title) => {
  const t = await attempt(() => api.addSubtask(id, title));
  return t && put(t);
};
/** @param {number} id @param {number} sid @param {{ title?: string, done?: boolean }} patch */
export const patchSubtask = async (id, sid, patch) => {
  const t = await attempt(() => api.patchSubtask(id, sid, patch));
  return t && put(t);
};
/** @param {number} id @param {number} sid */
export const deleteSubtask = async (id, sid) => {
  const t = await attempt(() => api.deleteSubtask(id, sid));
  return t && put(t);
};
/** New manual order of some tasks (positions 0…n-1 in this order). @param {number[]} ids */
export async function orderTasks(ids) {
  ids.forEach((id, i) => {
    const t = tasks.items.find((x) => x.id === id);
    if (t) t.pos = i;
  });
  await attempt(() => api.orderTasks(ids));
}
/** @param {string} title @param {string | null} emoji */
export async function createList(title, emoji) {
  const r = await attempt(() => api.createTaskList(title, emoji));
  if (r) await loadTasks(true);
  return r;
}
/** @param {number} id @param {{ title?: string, emoji?: string | null }} patch */
export async function updateList(id, patch) {
  if (await attempt(() => api.updateTaskList(id, patch))) await loadTasks(true);
}
/** @param {number} id */
export async function deleteList(id) {
  if (await attempt(() => api.deleteTaskList(id))) await loadTasks(true);
}

/** "5:1.2" or "5:1.2–1.4". @param {Task} t */
export const placeLabel = (t) => (t.ref ? (t.refEnd ? `${t.ref}–${t.refEnd.split(':')[1]}` : t.ref) : '');
