// @ts-check
// Chat state shared by the app: the chat list, unread counters, "печатает…", and the live event
// stream (Server-Sent Events) that open conversations and paragraph threads listen to.
import { api } from './api.js';
import { session } from './session.svelte.js';
import { notify, refreshCounts } from './notify.svelte.js';

/** @typedef {{ type: 'message' | 'edit' | 'delete' | 'reactions' | 'typing' | 'reload', key: string } & Record<string, any>} ChatEvent */

export const chat = $state({
  /** @type {import('./api.js').ChatSummary[]} */ list: [],
  loaded: false,
  /** The conversation open on screen (its messages count as read). @type {string | null} */ active: null,
  /** key → who is typing and until when. @type {Record<string, { name: string, until: number }>} */ typing: {},
});

/** The chat list's controls that live in the phone's header: the search field and the new-channel form. */
export const chatUi = $state({ search: false, creating: false });

/** @type {Set<(e: ChatEvent) => void>} */
const listeners = new Set();
/** @param {(e: ChatEvent) => void} fn */
export function onChatEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function recount() {
  notify.chatUnread = chat.list.reduce((s, c) => s + c.unread, 0);
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
      chat.list.sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
      recount();
    } else if (!mine) void loadChats(); // a chat the list does not show yet (e.g. a new mention)
    if (!mine) void refreshCounts(); // the bell (mentions, followed threads)
  }
  for (const fn of listeners) fn(e);
}

/** Opens the live stream once per tab; the browser reconnects by itself. */
export function connectChat() {
  void loadChats();
  const es = new EventSource('/api/chat/stream');
  es.onmessage = (ev) => {
    try {
      handle(JSON.parse(ev.data));
    } catch {}
  };
  return () => es.close();
}

/** Telegram's palette for names and avatars, picked by user id. */
const COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
/** @param {number | null | undefined} id */
export const userColor = (id) => COLORS[Math.abs(id ?? 0) % COLORS.length];
/** "Анна Петрова" → "АП". @param {string | null | undefined} name */
export const initials = (name) =>
  (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
