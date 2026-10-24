// @ts-check
// Personal tasks, sorted by tags. As notes (notes.svelte.js): what the server knows comes from the feed
// of changes (feed.js — the person's tasks kept on the device whole), every change goes through the
// device's queue (outbox.svelte.js) and shows at once, with or without a network — `tasks.items` is the
// kept tasks with the waiting changes laid over them by the server's rules. A new task gets its own id
// on the device (`uid`; a local negative number on screen, "u-<uid>" for the API) until the server
// numbers it; a subtask made and ticked before it was sent carries the tick in its creation.
import { api } from './api.js';
import { taskTags, titleTags, stripTag, normTag } from '../../../shared/tasktags.js';
export { taskTags };
import { showToast } from './toast.svelte.js';
import { notify } from './notify.svelte.js';
import { navigate } from './router.svelte.js';
import { notes } from './notes.svelte.js';
import { tasksFeed } from './feed.js';
import { outbox, uuid, amend, discard } from './outbox.svelte.js';

/** @typedef {import('./api.js').Task} Task */

export const tasks = $state({
  /** @type {Task[]} */ items: [],
  loaded: false,
});

/** The user's calendar day, YYYY-MM-DD. @param {number} [plusDays] */
export function today(plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The tasks kept on the device are read (they come with the workspace: feed.js openFeed). */
export async function loadTasks(force = false) {
  await tasksFeed.ready();
  recompute();
  tasks.loaded = true;
  if (force) void tasksFeed.pull();
}

// ---- The waiting changes over what the server knows (the server's rules: server/api/tasks.js) ----

/** @typedef {{ method: string, url: string, body: any, at: string, user: number, seq?: number, state?: 'wait' | 'failed', id?: string }} Change */

const sqlTime = (/** @type {string} */ iso) => iso.slice(0, 19).replace('T', ' ');
/** A task made here, before the server numbers it: a negative number, the same for the same uid. @param {string} uid */
export const localTaskId = (uid) => -(parseInt(uid.replace(/[^0-9a-f]/gi, '').slice(0, 12) || '1', 16) || 1);
/** The API's address of a task on screen. @param {number} id */
function addr(id) {
  if (id > 0) return id;
  const uid = tasks.items.find((t) => t.id === id)?.uid;
  return uid ? `u-${uid}` : id;
}
/** The task's tags as the server keeps them (shared/tasktags.js). @param {unknown} v */
const tagList = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' ? normTag(x) : null)).filter((x) => x !== null))].slice(0, 20);
/** @param {Task} a @param {Task} b */
const byPos = (a, b) => a.pos - b.pos || a.id - b.id;

/** A task made here (POST /api/tasks), as the server will make it: at the top. @param {Change} op @param {Task[]} list @returns {Task} */
function localTask(op, list) {
  const b = op.body;
  return /** @type {Task} */ ({
    id: localTaskId(b.uid), uid: b.uid, title: String(b.title ?? '').trim(), notes: b.notes ?? null, status: 'todo',
    important: !!b.important, due: b.due ?? null, tags: tagList(b.tags), ref: b.ref ?? null, refEnd: b.refEnd ?? null,
    annotationId: b.annotationId ?? null, collectionId: b.collectionId ?? null, collectionTitle: null, paperTitle: null,
    pos: Math.min(0, ...list.map((t) => t.pos)) - 1, doneAt: null, createdAt: sqlTime(op.at), updatedAt: sqlTime(op.at),
    messageId: b.messageId ?? null, messageChat: null, messageChatTitle: null, subtasks: [], pending: 'wait',
  });
}

/** One waiting change laid over the tasks. @param {Task[]} list @param {Change} op */
function overlay(list, op) {
  const b = op.body ?? {};
  if (op.url === '/api/tasks') return op.method !== 'POST' || list.some((t) => t.uid === b.uid) ? list : [localTask(op, list), ...list];
  const find = (/** @type {string | number} */ a) => {
    const m = String(a).match(/^u-(.+)$/);
    return list.findIndex((t) => (m ? t.uid === m[1] : t.id === Number(a)));
  };
  if (op.url === '/api/tasks/order') {
    const out = [...list];
    (b.ids ?? []).forEach((/** @type {string | number} */ a, /** @type {number} */ pos) => {
      const i = find(a);
      if (i >= 0) out[i] = { ...out[i], pos };
    });
    return out;
  }
  const [a, sub, sid] = op.url.slice('/api/tasks/'.length).split('/');
  const i = find(a);
  if (i < 0) return list;
  const out = [...list];
  if (!sub && op.method === 'DELETE') {
    out.splice(i, 1);
    return out;
  }
  const t = { ...list[i], updatedAt: sqlTime(op.at) };
  if (!sub) {
    for (const k of /** @type {const} */ (['title', 'notes', 'status', 'important', 'due', 'ref', 'refEnd', 'annotationId', 'collectionId'])) {
      if (k in b) /** @type {any} */ (t)[k] = k === 'important' ? !!b[k] : b[k];
    }
    if ('tags' in b) t.tags = tagList(b.tags);
    t.doneAt = t.status === 'done' ? (t.doneAt ?? sqlTime(op.at)) : null;
  } else if (op.method === 'POST') t.subtasks = [...t.subtasks, { id: -(op.seq ?? (Date.now() % 1e9)), title: b.title, done: !!b.done, pending: 'wait', op: op.id }];
  else if (op.method === 'PATCH') t.subtasks = t.subtasks.map((s) => (s.id === Number(sid) ? { ...s, ...('title' in b ? { title: b.title } : {}), ...('done' in b ? { done: !!b.done } : {}) } : s));
  else t.subtasks = t.subtasks.filter((s) => s.id !== Number(sid));
  out[i] = t;
  return out;
}

/** What is on screen: the kept tasks, with the changes still waiting over them. */
function recompute() {
  let list = [...tasksFeed.items()].sort(byPos);
  for (const op of outbox.items) if (op.kind === 'task' && op.state === 'wait') list = overlay(list, /** @type {Change} */ (op));
  tasks.items = list.sort(byPos);
}
if (typeof window !== 'undefined') {
  addEventListener('ub-outbox', recompute);
  addEventListener('ub-feed-tasks', recompute);
}

/** @param {string} method @param {string} url @param {unknown} body @returns {Change} */
const op = (method, url, body) => ({ method, url, body, at: new Date().toISOString(), user: 0 });

/**
 * A change: on screen at once, into the queue, the server's answer when it comes (a refusal: the screen
 * shows what the server has; the change stays in "Ждут отправки").
 * @param {Change} c @param {() => Promise<any>} send
 */
function change(c, send) {
  tasks.items = overlay(tasks.items, c).sort(byPos);
  send().then(
    (res) => res && typeof res === 'object' && 'id' in res && 'title' in res && tasksFeed.apply(res),
    (err) => {
      if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
      recompute();
    },
  );
}
const found = (/** @type {number} */ id) => tasks.items.find((t) => t.id === id) ?? null;

/** @param {import('./api.js').TaskPatch & { title: string }} fields */
export async function createTask(fields) {
  await loadTasks();
  const body = { ...fields, uid: uuid() };
  const c = op('POST', '/api/tasks', body);
  const local = localTask(c, tasks.items);
  change(c, () => api.createTask(body));
  return local;
}
/** @param {number} id @param {import('./api.js').TaskPatch} patch */
export async function patchTask(id, patch) {
  const a = addr(id);
  change(op('PATCH', `/api/tasks/${a}`, patch), () => api.patchTask(/** @type {any} */ (a), patch));
  return found(id);
}
/** @param {number} id */
export async function deleteTask(id) {
  const a = addr(id);
  change(op('DELETE', `/api/tasks/${a}`, null), () => api.deleteTask(/** @type {any} */ (a)));
}
/** @param {number} id @param {string} title */
export const addSubtask = async (id, title) => {
  const a = addr(id);
  change(op('POST', `/api/tasks/${a}/subtasks`, { title }), () => api.addSubtask(/** @type {any} */ (a), title));
  return found(id);
};
/** The change that made a subtask not sent yet (its local id), if any. @param {number} id @param {number} sid */
const waitingSubtask = (id, sid) => (sid < 0 ? /** @type {any} */ (found(id)?.subtasks.find((s) => s.id === sid))?.op : undefined);
/** @param {number} id @param {number} sid @param {{ title?: string, done?: boolean }} patch */
export const patchSubtask = async (id, sid, patch) => {
  // made and changed before it reached the server: its creation carries the change
  const made = outbox.items.find((o) => o.id === waitingSubtask(id, sid));
  if (made && (await amend(made, { .../** @type {object} */ (made.body), ...patch }))) return found(id);
  const a = addr(id);
  change(op('PATCH', `/api/tasks/${a}/subtasks/${sid}`, patch), () => api.patchSubtask(/** @type {any} */ (a), sid, patch));
  return found(id);
};
/** @param {number} id @param {number} sid */
export const deleteSubtask = async (id, sid) => {
  const made = outbox.items.find((o) => o.id === waitingSubtask(id, sid));
  if (made) return void (await discard(made)); // (never sent: nothing to delete on the server)
  const a = addr(id);
  change(op('DELETE', `/api/tasks/${a}/subtasks/${sid}`, null), () => api.deleteSubtask(/** @type {any} */ (a), sid));
  return found(id);
};
/** New manual order of some tasks (positions 0…n-1 in this order). @param {number[]} ids */
export async function orderTasks(ids) {
  const addrs = ids.map(addr);
  change(op('PUT', '/api/tasks/order', { ids: addrs }), () => api.orderTasks(/** @type {any} */ (addrs)));
}
/**
 * The user's task tags with how many open tasks each has — the sections of the tasks page and the
 * suggestions of the tags field (most used first).
 * @returns {{ name: string, count: number }[]}
 */
export function tagCounts() {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const t of tasks.items) for (const tag of taskTags(t)) m.set(tag, (m.get(tag) ?? 0) + (t.status === 'done' ? 0 : 1));
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The task's tags changed in its details (the field shows the title's and the added ones together):
 * a removed tag that is in the title goes out of the title as well, so it does not come back.
 * @param {Task} t @param {string[]} next
 */
export async function setTaskTags(t, next) {
  const want = [...new Set(next.map((x) => normTag(x)).filter((x) => x !== null))];
  let title = t.title;
  for (const tag of titleTags(t.title)) if (!want.includes(tag)) title = stripTag(title, tag);
  if (!title.trim()) {
    showToast('Название не может остаться пустым — сначала допишите его');
    return;
  }
  const inTitle = titleTags(title);
  await patchTask(t.id, { title, tags: want.filter((x) => !inTitle.includes(x)) });
}

/**
 * Back to the message a task was made from: its conversation in the chat, scrolled to it (a note's
 * comment — the note in the book).
 * @param {Task} t
 */
export function openTaskMessage(t) {
  if (!t.messageChat) return;
  if (t.messageChat.startsWith('note:')) {
    if (t.ref) navigate(`/${t.ref}`);
    notes.activeId = Number(t.messageChat.slice(5));
    return;
  }
  navigate(`/chat?c=${encodeURIComponent(t.messageChat)}&m=${t.messageId ?? ''}`);
}

/** The task as text, to copy: its title, description and subtasks (☐ / ☑). @param {Task} t */
export const taskText = (t) =>
  [t.title, t.notes ?? '', ...t.subtasks.map((s) => `${s.done ? '☑' : '☐'} ${s.title}`)].filter(Boolean).join('\n');
/** "5:1.2" or "5:1.2–1.4". @param {Task} t */
export const placeLabel = (t) => (t.ref ? (t.refEnd ? `${t.ref}–${t.refEnd.split(':')[1]}` : t.ref) : '');
