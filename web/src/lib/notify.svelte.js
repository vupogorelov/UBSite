// @ts-check
// In-app notifications (the bell) and the vote queue counter. No real time: the counters are
// refreshed on navigation, when the tab gets focus again and once a minute while it is visible.
import { api } from './api.js';

const POLL_MS = 60_000;

export const notify = $state({
  unread: 0,
  /** Proposals waiting for the user's vote. */ queue: 0,
  /** Personal tasks due today or overdue. */ tasksDue: 0,
  /** Unread messages over the chat list. */ chatUnread: 0,
  /** @type {import('./api.js').AppNotification[]} */ items: [],
  loading: false,
});

let inflight = false;

export async function refreshCounts() {
  if (inflight) return;
  inflight = true;
  try {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const [counts, due, chats] = await Promise.all([api.notificationCount(), api.taskCount(day), api.chatUnread()]);
    Object.assign(notify, counts, { tasksDue: due.due, chatUnread: chats.unread });
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
  const timer = setInterval(() => document.visibilityState === 'visible' && refreshCounts(), POLL_MS);
  const onVisible = () => document.visibilityState === 'visible' && refreshCounts();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
