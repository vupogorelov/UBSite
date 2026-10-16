// @ts-check
// In-app notifications (the bell) and the vote queue counter. Refreshed at once when a message comes
// over the live stream (lib/chat.svelte.js), on navigation, when the tab gets focus again, and — for what
// the stream does not carry (votes, the queue, a newer build) — every five minutes while it is visible.
import { api } from './api.js';
import { checkVersion } from './version.svelte.js';

const POLL_MS = 5 * 60_000;

export const notify = $state({
  unread: 0,
  /** Proposals waiting for the user's vote. */ queue: 0,
  /** Unread messages over the chat list. */ chatUnread: 0,
  /** @type {import('./api.js').AppNotification[]} */ items: [],
  loading: false,
});

let inflight = false;

export async function refreshCounts() {
  if (inflight) return;
  inflight = true;
  try {
    const [counts, chats] = await Promise.all([api.notificationCount(), api.chatUnread()]);
    Object.assign(notify, counts, { chatUnread: chats.unread });
  } catch {
    // offline or signed out: keep the last numbers
  } finally {
    inflight = false;
  }
}

/** Opens the list: loads it, then marks everything in it read (new items stay highlighted while open). */
export async function openList() {
  notify.loading = true;
  try {
    const r = await api.notifications();
    notify.items = r.items;
    notify.queue = r.queue;
    if (r.unread) notify.unread = (await api.notificationsSeen()).unread;
  } catch {
    notify.items = [];
  } finally {
    notify.loading = false;
  }
}

/** Starts polling; returns the cleanup. */
export function startPolling() {
  void refreshCounts();
  const tick = () => {
    if (document.visibilityState !== 'visible') return;
    void refreshCounts();
    void checkVersion(); // a newer build of the app: the bell offers a restart
  };
  const timer = setInterval(tick, POLL_MS);
  const onVisible = tick;
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
