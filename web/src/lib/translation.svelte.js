// @ts-check
// Public layer state: proposals and thread counters of the open paper, the open paragraph thread.
import { api } from './api.js';
import { showToast } from './toast.svelte.js';
import { refreshCounts } from './notify.svelte.js';
import { session } from './session.svelte.js';

/** @typedef {import('./api.js').Proposal} Proposal */
/** @typedef {{ ref: string, start: number, end: number, original: string }} Fragment */

export const tr = $state({
  /** @type {number | null} */ paperId: null,
  /** @type {Proposal[]} */ proposals: [],
  /** Public messages per paragraph ref. @type {Record<string, number>} */ messages: {},
  /** A guest's view (not signed in): the published variants per paragraph ref — numbers, not the variants. @type {Record<string, number>} */ guestProposals: {},
  /** @type {import('./api.js').VotingConfig | null} */ config: null,
  /** Incremented on every change, so lists elsewhere know to reload. */
  version: 0,
});

/** The paragraph thread drawer. */
export const thread = $state({
  /** @type {string | null} */ ref: null,
  /** @type {Proposal[]} */ proposals: [],
  /** @type {import('./api.js').PublicMessage[]} */ messages: [],
  loading: false,
  /** A fragment being translated (new draft), shown as an editor at the top. @type {Fragment | null} */
  compose: null,
  /** Proposal to scroll to and expand. @type {number | null} */ focus: null,
  /** The reader gets notifications about this thread. */ following: false,
});

/** "Следить" / "Не следить" for the open thread. */
export async function toggleFollow() {
  if (!thread.ref) return;
  try {
    thread.following = (await api.follow(thread.ref, !thread.following)).following;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
  }
}

/** @param {number} paperId */
export async function loadPublicPaper(paperId) {
  if (!session.user) {
    // a guest (a shared link): the numbers only
    const g = await api.guestPaper(paperId);
    Object.assign(tr, { paperId, proposals: [], messages: g.messages, guestProposals: g.proposals });
    return;
  }
  tr.guestProposals = {};
  const r = await api.publicPaper(paperId);
  tr.paperId = paperId;
  tr.proposals = r.proposals;
  tr.messages = r.messages;
  if (!tr.config) tr.config = await api.votingConfig().catch(() => null);
}

/** @param {string} ref @param {{ compose?: Fragment | null, focus?: number | null }} [opts] */
export async function openThread(ref, opts = {}) {
  if (thread.ref !== ref) {
    thread.proposals = [];
    thread.messages = [];
  }
  thread.ref = ref;
  thread.compose = opts.compose ?? null;
  thread.focus = opts.focus ?? null;
  await reloadThread();
}

export function closeThread() {
  thread.ref = null;
  thread.compose = null;
  thread.focus = null;
}

export async function reloadThread() {
  if (!thread.ref) return;
  const ref = thread.ref;
  thread.loading = true;
  try {
    const r = await api.thread(ref);
    if (thread.ref !== ref) return;
    thread.proposals = r.proposals;
    thread.messages = r.messages;
    thread.following = r.following;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
  } finally {
    thread.loading = false;
  }
}

/** Runs a change, then refreshes the thread and the paper marks. @template T @param {() => Promise<T>} fn */
export async function change(fn) {
  try {
    const result = await fn();
    tr.version++;
    void refreshCounts(); // a vote changes the queue, taking part changes what is followed
    await Promise.all([reloadThread(), tr.paperId !== null ? loadPublicPaper(tr.paperId) : null]);
    return result;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
    return null;
  }
}

/** Human-readable voting state: "3 за · 1 против · нужно 80% и ещё 1 голос". @param {Proposal} p */
export function votingSummary(p) {
  const { for: yes, against: no, abstain } = p.votes;
  const parts = [`${yes} за`, `${no} против`];
  if (abstain) parts.push(`${abstain} возд.`);
  const cfg = tr.config;
  if (p.status === 'voting' && cfg) {
    const decisive = yes + no;
    const missing = Math.max(0, cfg.quorum - decisive);
    parts.push(missing ? `до кворума ещё ${missing}` : `нужно ≥${Math.round(cfg.threshold * 100)}% за`);
  }
  return parts.join(' · ');
}

export const STATUS_NAMES = /** @type {const} */ ({
  draft: 'Черновик',
  voting: 'На голосовании',
  approved: 'Принято',
  rejected: 'Отклонено',
  superseded: 'Заменено',
});
