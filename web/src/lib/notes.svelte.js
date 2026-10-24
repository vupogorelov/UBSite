// @ts-check
// Annotations of the open paper plus the UI state around them (active note, comment draft).
//
// Every change goes through the device's queue (outbox.svelte.js) and shows at once, with or without a
// network: what is on screen is what the server knows of the paper's notes (`known`) with the changes
// still waiting laid over it by the server's own rules (`overlay`) — so they stay after a reload too, and
// the server's answer simply takes their place. A new note gets its own id on the device (`uid`): until
// the server numbers it, it is shown under a local negative number and addressed as "u-<uid>", so
// tagging, commenting or deleting it without a network needs nothing renumbered.
import { api, current } from './api.js';
import { settings } from './settings.svelte.js';
import { NOTE_COLORS, settingDefaults } from '../../../shared/settings.js';
import { showToast } from './toast.svelte.js';
import { writeText } from './clipboard.js';
import { onChatEvent, toggleReaction } from './chat.svelte.js';
import { outbox, uuid } from './outbox.svelte.js';
import { session } from './session.svelte.js';
import { feedNotes, feedReady, feedApply, pull } from './feed.js';

/** @typedef {import('./api.js').Note} Note */
/** @typedef {import('./api.js').NoteColor} NoteColor */
/** @typedef {{ ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null, quote: string | null }} Anchor */
/** A comment being written: for a new anchor, or for an existing note without comments. */
/** @typedef {Anchor & { noteId: number | null }} Draft */
/**
 * The text actions' panel (SelectionToolbar): mode "new" — a fresh text selection; "edit" — an existing
 * note; "para" — a whole paragraph.
 * @typedef {{ mode: 'new' | 'edit' | 'para', x: number, y: number, below: boolean, cx?: number, anchor: Anchor, noteId: number | null, text: string }} ToolbarState
 */

export const notes = $state({
  /** @type {number | null} */ paperId: null,
  /** @type {Note[]} */ items: [],
  /** @type {number | null} */ activeId: null,
  /** @type {Draft | null} */ draft: null,
  /** The card whose reply field takes the cursor once shown (after its first comment was sent). @type {number | null} */
  focusReply: null,
  /** Incremented on every change, so lists elsewhere know to reload. */
  version: 0,
});

// What the server knows comes from the feed of changes (feed.js): the workspace's notes kept on the
// device whole, brought up to date by the server's "what changed". `notes.items` is the open paper's
// part of it with the waiting changes over it; `allNotes()` — every paper's, for the lists.

/** @param {number} paperId */
export async function loadPaperNotes(paperId) {
  listenLive();
  notes.paperId = paperId;
  await feedReady();
  if (notes.paperId === paperId) recompute();
  void pull();
}

/** "5:1.3" → [5, 1, 3]: the book's order (as the server's ORDER BY p.seq). @param {string} ref */
const refKey = (ref) => String(ref).split(/[:.]/).map(Number);
/** Notes in the order of the book, then the whole paragraph before a fragment, Russian before English, by start. @param {Note} a @param {Note} b */
function bookOrder(a, b) {
  const x = refKey(a.ref);
  const y = refKey(b.ref);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  if ((a.lang === null) !== (b.lang === null)) return a.lang === null ? -1 : 1;
  if (a.lang !== b.lang) return a.lang === 'ru' ? -1 : 1;
  return (a.start ?? 0) - (b.start ?? 0) || a.id - b.id;
}

/** Every note of the workspace as it is now (the lists: Заметки, the book's notes), in the order of the book. */
export function allNotes() {
  let list = [...feedNotes()];
  for (const op of outbox.items) if (op.kind === 'note' && op.state === 'wait') list = overlay(list, /** @type {Change} */ (op), null);
  return list.sort(bookOrder);
}

// ---- The waiting changes over what the server knows ----

/** @typedef {{ method: string, url: string, body: any, at: string, user: number, seq?: number, state?: 'wait' | 'failed' }} Change */

const sqlTime = (/** @type {string} */ iso) => iso.slice(0, 19).replace('T', ' ');
const paperOf = (/** @type {string} */ ref) => Number(String(ref).split(':')[0]);
const sectionOf = (/** @type {string} */ ref) => Number(String(ref).split(':')[1]?.split('.')[0] ?? 0);
const notesUrl = () => `/api/workspaces/${current.ws}/annotations`;
/** A note made here, before the server numbers it: a negative number, the same for the same uid. @param {string} uid */
export const localId = (uid) => -(parseInt(uid.replace(/[^0-9a-f]/gi, '').slice(0, 12) || '1', 16) || 1);
/** The API's address of a note on screen: its number, or "u-<uid>" for one not on the server yet. @param {number} id */
function addr(id) {
  if (id > 0) return id;
  const uid = notes.items.find((n) => n.id === id)?.uid;
  return uid ? `u-${uid}` : id;
}
const myName = () => session.user?.displayName ?? session.user?.username ?? null;

/** A comment written here, not on the server yet (shown with its clock). @param {Change} op @param {string} body */
const localComment = (op, body) =>
  /** @type {import('./api.js').NoteComment} */ (/** @type {unknown} */ ({
    id: -(op.seq ?? Date.now() % 1e9) - 1, kind: 'message', body, createdAt: sqlTime(op.at), updatedAt: sqlTime(op.at),
    authorId: op.user, authorName: myName(), replyTo: op.body?.replyTo ?? null, reactions: [], pending: 'wait',
  }));

/** A note made here (POST …/annotations), as the server will make it. @param {Change} op @returns {Note} */
function localNote(op) {
  const b = op.body;
  const color = b.lang ? (b.color ?? null) : null; // (a color only on a fragment, and it makes a bookmark)
  const bookmark = b.bookmark === true || color !== null;
  return {
    id: localId(b.uid), uid: b.uid, ref: b.ref, lang: b.lang ?? null, start: b.start ?? null, end: b.end ?? null, quote: b.quote ?? null,
    color, bookmark, title: bookmark ? (b.title ?? null) : null, resolved: false, createdAt: sqlTime(op.at), updatedAt: sqlTime(op.at),
    paperId: paperOf(b.ref), sectionNum: sectionOf(b.ref), paperTitle: null, authorId: op.user, authorName: myName(),
    comments: b.comment ? [localComment(op, b.comment)] : [], tags: [...(b.tags ?? [])], pending: 'wait',
  };
}

/**
 * One waiting change laid over the notes, by the server's rules (server/api/annotations.js).
 * @param {Note[]} list @param {Change} op @param {number | null} [paper] a new note only of this paper (null — any)
 */
function overlay(list, op, paper = notes.paperId) {
  const base = notesUrl();
  if (!op.url.startsWith(base)) return list; // (another workspace's)
  const b = op.body ?? {};
  if (op.url === base) {
    if (op.method !== 'POST' || (paper !== null && paperOf(b.ref) !== paper) || list.some((n) => n.uid === b.uid)) return list;
    return [...list, localNote(op)];
  }
  const [a, sub, cid] = op.url.slice(base.length + 1).split('/');
  const byUid = a.match(/^u-(.+)$/);
  const i = list.findIndex((n) => (byUid ? n.uid === byUid[1] : n.id === Number(a)));
  if (i < 0) return list;
  const out = [...list];
  if (!sub && op.method === 'DELETE') {
    out.splice(i, 1);
    return out;
  }
  const n = { ...list[i], updatedAt: sqlTime(op.at) };
  if (!sub) {
    if ('resolved' in b) n.resolved = !!b.resolved;
    let color = 'color' in b ? (n.lang ? (b.color ?? null) : null) : n.color;
    let bookmark = 'bookmark' in b ? !!b.bookmark : n.bookmark;
    if ('color' in b && color) bookmark = true; // a color makes a bookmark
    if (!bookmark) color = null; // no bookmark — no color
    n.color = color;
    n.bookmark = bookmark;
    if ('title' in b && b.title) n.title = b.title; // (no name given: the server names it by its sentence)
    if (!bookmark) n.title = null;
  } else if (sub === 'tags') n.tags = [...(b.tags ?? [])];
  else if (sub === 'comments' && !cid) n.comments = [...n.comments, localComment(op, b.body)];
  else if (sub === 'comments' && op.method === 'PATCH') n.comments = n.comments.map((c) => (c.id === Number(cid) ? { ...c, body: b.body } : c));
  else if (sub === 'comments' && op.method === 'DELETE') n.comments = n.comments.filter((c) => c.id !== Number(cid));
  out[i] = n;
  return out;
}

/** What is on screen: what the server knows, with the changes still waiting over it. */
function recompute() {
  let list = feedNotes().filter((n) => n.paperId === notes.paperId).sort(bookOrder);
  for (const op of outbox.items) if (op.kind === 'note' && op.state === 'wait') list = overlay(list, /** @type {Change} */ (op));
  // a note just numbered by the server: whatever pointed to its local number points to it now
  for (const n of list) {
    if (!n.uid || n.id < 0) continue;
    const was = localId(n.uid);
    if (notes.activeId === was) notes.activeId = n.id;
    if (notes.focusReply === was) notes.focusReply = n.id;
    if (notes.draft?.noteId === was) notes.draft.noteId = n.id;
  }
  notes.items = list;
}
if (typeof window !== 'undefined') {
  addEventListener('ub-outbox', recompute);
  // the feed moved (other devices, other people, one's own answered change): the lists reload too
  addEventListener('ub-feed', () => {
    notes.version++;
    recompute();
  });
}

/** The server's answer to a change: it takes the place of what was shown. @param {import('./api.js').NoteResult} res */
function answered(res) {
  feedApply(res); // (→ "ub-feed": shown, and the lists reload)
}

/**
 * A change: on screen at once, into the queue, the server's answer when it comes. Refused: the screen
 * shows what the server has (the change stays in "Ждут отправки", to try again or give up).
 * @param {Change} change @param {() => Promise<import('./api.js').NoteResult>} send
 */
function change(change, send) {
  notes.items = overlay(notes.items, change);
  notes.version++;
  send().then(answered, (err) => {
    if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
    recompute();
  });
}
/** @param {string} method @param {string} path @param {unknown} body @returns {Change} */
const op = (method, path, body) => ({ method, url: notesUrl() + path, body, at: new Date().toISOString(), user: session.user?.id ?? 0 });
const found = (/** @type {number} */ id) => notes.items.find((n) => n.id === id) ?? null;

/** @param {number} id @param {string[]} names */
export async function setNoteTags(id, names) {
  const a = addr(id);
  change(op('PUT', `/${a}/tags`, { tags: names }), () => api.setNoteTags(a, names));
  return found(id);
}

/** @param {Anchor} anchor @param {{ color?: NoteColor, bookmark?: boolean, comment?: string, tags?: string[] }} props */
export async function createNote(anchor, props) {
  const body = { ref: anchor.ref, lang: anchor.lang, start: anchor.start, end: anchor.end, quote: anchor.quote, uid: uuid(), ...props };
  const c = op('POST', '', body);
  notes.items = [...notes.items, localNote(c)]; // (on screen at once, on any paper)
  notes.version++;
  api.createNote(body).then(answered, (err) => {
    if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
    recompute();
  });
  return localNote(c);
}

/** @param {number} id @param {Record<string, unknown>} patch */
export async function patchNote(id, patch) {
  const a = addr(id);
  change(op('PATCH', `/${a}`, patch), () => api.patchNote(a, patch));
  return found(id);
}

/** @param {number} id */
export async function deleteNote(id) {
  const a = addr(id);
  if (notes.activeId === id) notes.activeId = null;
  change(op('DELETE', `/${a}`, null), () => api.deleteNote(a));
}

/** @param {number} id @param {string} body @param {number | null} [replyTo] */
export async function addComment(id, body, replyTo = null) {
  const a = addr(id);
  change(op('POST', `/${a}/comments`, { body, replyTo }), () => api.addComment(a, body, replyTo));
  return found(id);
}

// Comments are the notes' conversations ("note:<id>"): what others write, edit or react to in the
// open paper's notes arrives live and reloads them. Subscribed on the first load (chat.svelte.js
// imports this module through the session, so not at import time).
let live = false;
let reloadTimer = 0;
function listenLive() {
  if (live) return;
  live = true;
  onChatEvent((e) => {
    if (!e.key.startsWith('note:') || e.type === 'typing') return;
    // a note's conversation moved (anyone's note of this workspace): the feed brings the change
    clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void pull(), 200);
  });
}

/** @param {number} id @param {number} cid @param {string} body */
export async function editComment(id, cid, body) {
  const a = addr(id);
  change(op('PATCH', `/${a}/comments/${cid}`, { body }), () => api.editComment(a, cid, body));
  return found(id);
}

/** @param {number} id @param {number} cid */
export async function deleteComment(id, cid) {
  const a = addr(id);
  change(op('DELETE', `/${a}/comments/${cid}`, null), () => api.deleteComment(a, cid));
}

/** Toggles the user's reaction on a note's comment. @param {number} id @param {number} cid @param {string} emoji */
export async function reactComment(id, cid, emoji) {
  // at once, through the queue (the feed brings the server's state after)
  const find = () => notes.items.find((n) => n.id === id)?.comments.find((x) => x.id === cid);
  const c = find();
  if (!c) return;
  const was = c.reactions ?? [];
  c.reactions = toggleReaction(was, emoji, myName() ?? '');
  api.react(cid, emoji).then(
    (res) => {
      const x = find();
      if (x) x.reactions = res.reactions;
    },
    (err) => {
      const x = find();
      if (x) x.reactions = was;
      if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
    },
  );
}

/**
 * Sends the draft: a new note with a comment, or the first comment of an existing note.
 * @param {string} body @returns {Promise<boolean>} sent
 */
export async function submitDraft(body) {
  const d = notes.draft;
  if (!d) return false;
  const note = d.noteId !== null ? await addComment(d.noteId, body) : await createNote(d, { comment: body });
  if (note) {
    // The draft card (with the focused field) is replaced by the note's card: hand the cursor over to it.
    notes.focusReply = note.id;
    notes.draft = null;
    notes.activeId = note.id;
  }
  return !!note;
}

/** Workspace-specific name of a highlight color. @param {NoteColor} color */
export function colorName(color) {
  const key = NOTE_COLORS.find(([c]) => c === color)?.[1] ?? 'colorYellow';
  return settings[key] || settingDefaults()[key];
}

/** Notes that get a card: with comments, or the one being drafted. @param {Note} n */
export const hasThread = (n) => n.comments.length > 0 && (!n.resolved || settings.showResolved || notes.activeId === n.id);

/** "«quote» (5:1.3)" — guillemets for Russian, straight quotes for English. @param {string} text @param {string} ref @param {'ru' | 'en' | null} lang */
export function citation(text, ref, lang) {
  return lang === 'en' ? `"${text}" (${ref})` : `«${text}» (${ref})`;
}

/** @param {string} text */
export async function copyText(text) {
  showToast((await writeText(text)) ? 'Скопировано' : 'Не удалось скопировать');
}

/** "6 окт., 14:05" from SQLite UTC "2026-10-06 11:05:00". @param {string} sqlTime */
export function formatTime(sqlTime) {
  const d = new Date(sqlTime.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
