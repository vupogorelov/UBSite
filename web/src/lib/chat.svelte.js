// @ts-check
// Chat state shared by the app: the chat list, unread counters, "печатает…", and the live event
// stream (Server-Sent Events) that open conversations and paragraph threads listen to.
import { api } from './api.js';
import { session } from './session.svelte.js';
import { notify, refreshCounts } from './notify.svelte.js';
import { navigate } from './router.svelte.js';

/** @typedef {{ type: 'message' | 'edit' | 'delete' | 'reactions' | 'typing' | 'reload' | 'pin' | 'mark' | 'changed' | 'read', key: string } & Record<string, any>} ChatEvent */

export const chat = $state({
  /** @type {import('./api.js').ChatSummary[]} */ list: [],
  loaded: false,
  /** The conversation open on screen (its messages count as read). @type {string | null} */ active: null,
  /** key → who is typing and until when. @type {Record<string, { name: string, until: number }>} */ typing: {},
});

/**
 * The chat list's controls that live in the phone's header: the search field and the new-channel form;
 * `draft`: text to put into a conversation's input when it opens (a quote to discuss).
 */
export const chatUi = $state({
  search: false,
  creating: false,
  draft: /** @type {{ key: string, text: string } | null} */ (null),
  /** A message to answer when its conversation opens ("Обсудить" under the Book's post). */
  reply: /** @type {{ key: string, id: number } | null} */ (null),
});

/** A message body without its quoted lines' "> " (for previews: the chat list, a reply's quote). @param {string} body */
export const plainBody = (body) => body.replace(/^> ?/gm, '');

/**
 * "Обсудить" from the book: the paragraph's conversation in the chat, a selected fragment already in
 * the input as a quote ("> …"), the cursor after it for the comment.
 * @param {string} ref @param {string | null} [quote]
 */
export function discussInChat(ref, quote = null) {
  const q = quote?.trim();
  chatUi.draft = q ? { key: ref, text: `${q.split('\n').map((l) => `> ${l}`).join('\n')}\n` } : null;
  navigate(`/chat?c=${encodeURIComponent(ref)}`);
}

/** @type {Set<(e: ChatEvent) => void>} */
const listeners = new Set();
/** @param {(e: ChatEvent) => void} fn */
export function onChatEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The user's pinned chats first, in their order; then the newest first. */
function sortChats() {
  chat.list.sort((a, b) => (a.pinned ?? 10) - (b.pinned ?? 10) || (b.last?.id ?? 0) - (a.last?.id ?? 0));
}

export const MAX_PINNED = 10;

/**
 * Pins / unpins / reorders: the whole list of pinned chats in order. Shown at once, saved after.
 * @param {string[]} keys
 */
export async function setPinnedChats(keys) {
  const before = chat.list.map((c) => /** @type {[string, number | null]} */ ([c.key, c.pinned]));
  for (const c of chat.list) {
    const i = keys.indexOf(c.key);
    c.pinned = i < 0 ? null : i;
  }
  sortChats();
  try {
    await api.setPinnedChats(keys);
  } catch (err) {
    const was = new Map(before);
    for (const c of chat.list) c.pinned = was.get(c.key) ?? null;
    sortChats();
    throw err;
  }
}

function recount() {
  // a muted chat's messages are not counted (its own grey number stays in the list)
  notify.chatUnread = chat.list.reduce((s, c) => s + (c.muted ? 0 : c.unread), 0);
}

/** "Без звука" / "Включить звук" for a chat (its news is not counted). @param {string} key @param {boolean} muted */
export async function muteChat(key, muted) {
  const c = chat.list.find((x) => x.key === key);
  if (c) c.muted = muted;
  recount();
  try {
    await api.muteChat(key, muted);
  } catch {
    if (c) c.muted = !muted;
    recount();
  }
}

export async function loadChats() {
  try {
    chat.list = await api.chats();
    chat.loaded = true;
    recount();
  } catch {}
}

/** The open conversation was read up to a message. @param {string} key @param {number} upTo */
export function markRead(key, upTo) {
  const c = chat.list.find((x) => x.key === key);
  if (c && c.unread) {
    c.unread = 0;
    c.mentions = 0;
    recount();
  }
  void api.chatRead(key, upTo).catch(() => {});
}

let lastTyping = 0;
/** Tells others "печатает…" (at most every 3 s). @param {string} key */
export function sendTyping(key) {
  if (Date.now() - lastTyping < 3000) return;
  lastTyping = Date.now();
  void api.chatTyping(key).catch(() => {});
}

/** @param {ChatEvent} e */
function handle(e) {
  const me = session.user?.id;
  if (e.type === 'changed') {
    // notes or tasks changed (server/live.js): the feeds fetch them (lib/feed.js)
    dispatchEvent(new CustomEvent('ub-live-changed', { detail: e }));
    return;
  }
  if (e.type === 'typing') {
    if (e.userId === me) return;
    chat.typing[e.key] = { name: e.name, until: Date.now() + 5000 };
    setTimeout(() => {
      if ((chat.typing[e.key]?.until ?? 0) <= Date.now()) delete chat.typing[e.key];
    }, 5200);
  }
  if (e.type === 'message') {
    delete chat.typing[e.key];
    const c = chat.list.find((x) => x.key === e.key);
    const mine = e.message.authorId === me;
    if (c) {
      c.last = e.message;
      if (!mine && chat.active !== e.key) c.unread++;
      sortChats();
      recount();
    } else if (!mine && !e.key.startsWith('note:')) void loadChats(); // a chat the list does not show yet (notes' comments are not in it)
    if (!mine) void refreshCounts(); // the bell (mentions, followed threads)
  }
  for (const fn of listeners) fn(e);
}

/**
 * Opens the live stream once per tab; the browser reconnects by itself. What came while the stream
 * was down (no network, a sleeping phone) is fetched again when it is back: the list, the open conversation.
 */
export function connectChat() {
  void loadChats();
  const es = new EventSource('/api/chat/stream');
  let lost = false;
  es.onerror = () => (lost = true);
  es.onopen = () => {
    if (!lost) return;
    lost = false;
    void loadChats();
    // what changed while the stream was down: the notes and tasks are fetched again (lib/feed.js)
    dispatchEvent(new CustomEvent('ub-live-changed', { detail: { notes: 'all', tasks: true } }));
    if (chat.active) for (const fn of listeners) fn(/** @type {ChatEvent} */ ({ type: 'reload', key: chat.active }));
  };
  es.onmessage = (ev) => {
    try {
      handle(JSON.parse(ev.data));
    } catch {}
  };
  return () => es.close();
}

/**
 * One's reaction toggled, as the server will do it (shown at once; the server's answer settles it).
 * @param {import('./api.js').Reaction[]} list @param {string} emoji @param {string} me my name
 * @returns {import('./api.js').Reaction[]}
 */
export function toggleReaction(list, emoji, me) {
  const r = list.find((x) => x.emoji === emoji);
  if (!r) return [...list, { emoji, n: 1, mine: true, who: me, userIds: '' }];
  if (!r.mine) return list.map((x) => (x === r ? { ...x, n: x.n + 1, mine: true, who: x.who ? `${x.who}, ${me}` : me } : x));
  return r.n <= 1 ? list.filter((x) => x !== r) : list.map((x) => (x === r ? { ...x, n: x.n - 1, mine: false } : x));
}

/** Telegram's palette for names and avatars, picked by user id. */
const COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
/** @param {number | null | undefined} id */
export const userColor = (id) => COLORS[Math.abs(id ?? 0) % COLORS.length];
/** "Анна Петрова" → "АП". @param {string | null | undefined} name */
export const initials = (name) =>
  (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
