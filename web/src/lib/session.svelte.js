// @ts-check
// The signed-in user, the list of their workspaces and the current one with its role.
import { api, current, hooks } from './api.js';
import { loadSettings } from './settings.svelte.js';
import { notes, loadPaperNotes } from './notes.svelte.js';
import { loadTags, tags } from './tags.svelte.js';
import { search, runSearch, loadLibrary } from './search.svelte.js';

/** @typedef {import('./api.js').Role} Role */

const WS_KEY = 'ub.workspace';
const RANK = /** @type {Record<Role, number>} */ ({ viewer: 0, commenter: 1, editor: 2, owner: 3 });

export const session = $state({
  /** @type {import('./api.js').User | null} */ user: null,
  /** False until the first /api/auth/me answer: avoids flashing the login form. */
  checked: false,
  /** @type {import('./api.js').WorkspaceInfo[]} */ workspaces: [],
  /** @type {import('./api.js').WorkspaceInfo | null} */ workspace: null,
});

/** Rights in the current workspace. */
export const can = {
  get comment() {
    return RANK[session.workspace?.role ?? 'viewer'] >= RANK.commenter;
  },
  get edit() {
    return RANK[session.workspace?.role ?? 'viewer'] >= RANK.editor;
  },
  get own() {
    return session.workspace?.role === 'owner';
  },
};

hooks.unauthorized = () => {
  session.user = null;
};

function savedWorkspaceId() {
  try {
    return Number(localStorage.getItem(WS_KEY)) || null;
  } catch {
    return null;
  }
}

/** Loads the user and picks the workspace (the last used one, otherwise the personal one). */
export async function startSession() {
  try {
    session.user = (await api.me()).user;
    if (session.user) await refreshWorkspaces();
  } catch {
    session.user = null;
  } finally {
    session.checked = true;
  }
}

export async function refreshWorkspaces() {
  session.workspaces = await api.workspaces();
  const wanted = session.workspace?.id ?? savedWorkspaceId();
  const ws = session.workspaces.find((w) => w.id === wanted) ?? session.workspaces.find((w) => w.kind === 'personal') ?? session.workspaces[0];
  if (ws) await switchWorkspace(ws.id, { force: session.workspace?.id !== ws.id });
}

/** @param {number} id @param {{ force?: boolean }} [opts] */
export async function switchWorkspace(id, opts = {}) {
  const ws = session.workspaces.find((w) => w.id === id);
  if (!ws) return;
  const changed = current.ws !== id || opts.force;
  session.workspace = ws;
  current.ws = id;
  try {
    localStorage.setItem(WS_KEY, String(id));
  } catch {}
  if (!changed) return;
  // Everything workspace-specific reloads: settings, notes of the open paper, tags, saved queries.
  notes.activeId = null;
  notes.draft = null;
  notes.version++;
  tags.filter = null;
  await Promise.all([
    loadSettings().catch((err) => console.error('Settings not loaded:', err)),
    notes.paperId !== null ? loadPaperNotes(notes.paperId).catch(() => {}) : null,
    loadTags(true),
    loadLibrary(),
  ]);
  if (search.query) runSearch(search.query, { record: false });
}

/** @param {string} username @param {string} password */
export async function login(username, password) {
  session.user = (await api.login(username, password)).user;
  await refreshWorkspaces();
}

export async function logout() {
  await api.logout().catch(() => {});
  session.user = null;
  session.workspace = null;
  session.workspaces = [];
}
