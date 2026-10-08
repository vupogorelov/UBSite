// @ts-check
// Annotations of the open paper plus the UI state around them (active note, comment draft).
import { api } from './api.js';
import { settings } from './settings.svelte.js';
import { NOTE_COLORS, settingDefaults } from '../../../shared/settings.js';
import { showToast } from './toast.svelte.js';

/** @typedef {import('./api.js').Note} Note */
/** @typedef {import('./api.js').NoteColor} NoteColor */
/** @typedef {{ ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null, quote: string | null }} Anchor */
/** A comment being written: for a new anchor, or for an existing note without comments. */
/** @typedef {Anchor & { noteId: number | null }} Draft */

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

/** @param {number} paperId */
export async function loadPaperNotes(paperId) {
  const items = await api.notes(paperId);
  notes.paperId = paperId;
  notes.items = items;
}

/** @param {import('./api.js').NoteResult} res */
function apply(res) {
  notes.version++;
  if ('deleted' in res) {
    notes.items = notes.items.filter((n) => n.id !== res.id);
    if (notes.activeId === res.id) notes.activeId = null;
    return null;
  }
  const i = notes.items.findIndex((n) => n.id === res.id);
  if (i >= 0) notes.items[i] = res;
  else if (res.paperId === notes.paperId) notes.items.push(res);
  return res;
}

/** @template T @param {() => Promise<T>} fn @returns {Promise<T | null>} */
async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    showToast(`Не сохранено: ${/** @type {Error} */ (err).message}`);
    return null;
  }
}

/** @param {number} id @param {string[]} names */
export async function setNoteTags(id, names) {
  const res = await guarded(() => api.setNoteTags(id, names));
  return res && apply(res);
}

/** @param {Anchor} anchor @param {{ color?: NoteColor, bookmark?: boolean, comment?: string, tags?: string[] }} props */
export async function createNote(anchor, props) {
  const res = await guarded(() => api.createNote({ ref: anchor.ref, lang: anchor.lang, start: anchor.start, end: anchor.end, ...props }));
  return res && apply(res);
}

/** @param {number} id @param {Record<string, unknown>} patch */
export async function patchNote(id, patch) {
  const res = await guarded(() => api.patchNote(id, patch));
  return res && apply(res);
}

/** @param {number} id */
export async function deleteNote(id) {
  const res = await guarded(() => api.deleteNote(id));
  if (res) apply(res);
}

/** @param {number} id @param {string} body */
export async function addComment(id, body) {
  const res = await guarded(() => api.addComment(id, body));
  return res && apply(res);
}

/** @param {number} id @param {number} cid @param {string} body */
export async function editComment(id, cid, body) {
  const res = await guarded(() => api.editComment(id, cid, body));
  return res && apply(res);
}

/** @param {number} id @param {number} cid */
export async function deleteComment(id, cid) {
  const res = await guarded(() => api.deleteComment(id, cid));
  if (res) apply(res);
}

/** Sends the draft: a new note with a comment, or the first comment of an existing note. @param {string} body */
export async function submitDraft(body) {
  const d = notes.draft;
  if (!d) return;
  const note = d.noteId !== null ? await addComment(d.noteId, body) : await createNote(d, { comment: body });
  if (note) {
    // The draft card (with the focused field) is replaced by the note's card: hand the cursor over to it.
    notes.focusReply = note.id;
    notes.draft = null;
    notes.activeId = note.id;
  }
}

/** Workspace-specific name of a highlight color. @param {NoteColor} color */
export function colorName(color) {
  const key = /** @type {const} */ (NOTE_COLORS.find(([c]) => c === color)?.[1] ?? 'colorYellow');
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
  try {
    await navigator.clipboard.writeText(text);
    showToast('Скопировано');
  } catch {
    showToast('Не удалось скопировать');
  }
}

/** "6 окт., 14:05" from SQLite UTC "2026-10-06 11:05:00". @param {string} sqlTime */
export function formatTime(sqlTime) {
  const d = new Date(sqlTime.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
