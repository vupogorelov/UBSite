// @ts-check
import { orOnDevice } from './offline-search.js';
import { enqueue, policyFor, outboxHooks } from './outbox.svelte.js';
import { log } from './log.js';

/**
 * @typedef {{ id: number, titleRu: string, titleEn: string, subtitleRu: string | null, subtitleEn?: string | null }} Part
 * @typedef {{ id: number, partId: number, titleRu: string, titleEn: string, paragraphs?: number }} PaperInfo
 * @typedef {{ id: number, lang: 'ru' | 'en', written: string, spoken: string }} Pronunciation
 * @typedef {{ paperId: number, num: number, titleRu: string, titleEn: string }} TocSection
 * @typedef {{ parts: Part[], papers: PaperInfo[], sections: TocSection[] }} Toc
 * @typedef {{ ref: string, sectionNum: number, pageRef: string, ru: string, en: string }} Paragraph
 * @typedef {{
 *   paper: PaperInfo & { partTitleRu: string, partTitleEn?: string, partIntroRu?: string | null, partIntroEn?: string | null, partStart?: number },
 *   sections: { num: number, titleRu: string | null, titleEn: string | null }[],
 *   paragraphs: Paragraph[],
 *   prev: number | null,
 *   next: number | null,
 * }} PaperData
 * @typedef {import('../../../shared/settings.js').Settings} Settings
 * @typedef {{ id: number, name: string, kind: 'personal' | 'group', role: Role, settings: Settings }} Workspace
 * @typedef {[text: string, mark: 0 | 1][]} Segments
 * @typedef {{ ref: string, paperId: number, sectionNum: number, paperTitle: string, sectionTitle: string | null, ru: Segments, en: Segments }} SearchResult
 * @typedef {{ total: number, facets: Record<string, number>, refs?: string[], results: SearchResult[] }} SearchResponse
 * @typedef {Record<string, { ru: [number, number][], en: [number, number][] }>} Highlights
 * @typedef {{ id: number, title: string, query: string }} SavedQuery
 * @typedef {{ query: string, usedAt: string, uses: number }} RecentQuery
 * @typedef {'yellow' | 'green' | 'blue' | 'pink' | 'purple'} NoteColor
 * A note's comment: a message of the note's conversation ("note:<id>"), as in the chat.
 * @typedef {{
 *   id: number, body: string, createdAt: string, updatedAt: string, authorId: number | null, authorName: string | null,
 *   kind?: 'message' | 'event', hiddenAt?: string | null, reply?: { id: number, authorName: string | null, body: string } | null,
 *   reactions?: Reaction[]
 * }} NoteComment
 * @typedef {{
 *   id: number, ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null, quote: string | null,
 *   color: NoteColor | null, bookmark: boolean, title: string | null, resolved: boolean,
 *   createdAt: string, updatedAt: string, paperId: number | null, sectionNum: number | null, paperTitle: string | null,
 *   authorId: number | null, authorName: string | null, comments: NoteComment[], tags: string[],
 *   uid?: string | null, pending?: 'wait'
 * }} Note
 * `uid`: the note's own id from the device that made it; `pending`: made here and not on the server yet
 * (its `id` is then a local negative number; the API addresses it as "u-<uid>").
 * @typedef {number | string} NoteAddress a note's number, or "u-<uid>"
 * @typedef {{ at: string, level: 'info' | 'warn' | 'error', kind: string, name: string, data: unknown }} LogEvent
 * @typedef {{
 *   session: string, userId: number, userName: string, device: string, fromAt: string, toAt: string,
 *   events: LogEvent[], errors: number, warnings: number
 * }} LogSession
 * @typedef {{ name: string, color: NoteColor | null, description: string | null, count: number }} Tag
 * @typedef {Note | { id: number, deleted: true }} NoteResult
 * @typedef {'owner' | 'editor' | 'commenter' | 'viewer'} Role
 * @typedef {{ id: number, username: string, displayName: string | null, isAdmin: boolean, isTranslator: boolean, isCoordinator: boolean,
 *   email?: string | null, emailVerified?: boolean }} User
 * @typedef {'draft' | 'voting' | 'approved' | 'rejected' | 'superseded'} ProposalStatus
 * @typedef {{
 *   id: number, ref: string, start: number, end: number, original: string, text: string, note: string | null,
 *   status: ProposalStatus, version: number, authorId: number, authorName: string,
 *   createdAt: string, updatedAt: string, publishedAt: string | null, closesAt: string | null,
 *   decidedAt: string | null, decisionNote: string | null, supersededBy: number | null,
 *   paperId: number | null, paperTitle: string | null,
 *   votes: { for: number, against: number, abstain: number, mine: -1 | 0 | 1 | null },
 *   warnings: GlossaryWarning[],
 *   can: { edit: boolean, publish: boolean, withdraw: boolean, delete: boolean, vote: boolean, moderate: boolean }
 * }} Proposal
 * @typedef {{ emoji: string, n: number, mine: boolean, who: string, userIds: string }} Reaction
 * @typedef {{
 *   id: number, ref?: string, chat?: string, proposalId: number | null, kind: 'message' | 'event', authorId: number | null,
 *   authorName: string | null, authorUsername?: string | null, body: string, hiddenAt: string | null, createdAt: string, updatedAt: string,
 *   replyTo?: number | null, reply?: { id: number, authorName: string | null, body: string } | null, reactions?: Reaction[],
 *   mark?: Mark | null, chatTitle?: string,
 *   authorAgent?: boolean, anchorRef?: string | null, linkedId?: number | null, comments?: number,
 *   post?: { ref: string, ru: string, en: string, pageRef: string, paperId: number, paperTitle: string, paperTitleEn?: string } | null
 * }} PublicMessage
 * @typedef {{
 *   key: string, kind: 'para' | 'chan' | 'ws' | 'dm' | string, title: string, subtitle: string | null, members?: number,
 *   last: PublicMessage | null, unread: number, mentions: number, pinned: number | null, muted?: boolean, voice?: boolean,
 *   link?: string, linkLabel?: string
 * }} ChatSummary
 * kind: also a feature's kind of chat ("dict": an article's discussion), with `link` — the way to its subject
 * @typedef {{
 *   key: string, kind: 'para' | 'chan' | 'ws' | 'note' | 'dm' | string, title: string, subtitle: string | null, members?: number, archived?: boolean, text?: string,
 *   link?: string, linkLabel?: string,
 *   post?: { ru: string, en: string, pageRef: string, paperId: number, paperTitle: string, paperTitleEn?: string } | null,
 *   pinned: PinnedMessage | null, canPin: boolean, following?: boolean, voice?: boolean, discussion?: string | null
 * }} ChatInfo
 * @typedef {{ id: number, authorName: string | null, body: string, hiddenAt: string | null }} PinnedMessage
 * @typedef {{
 *   id: number, ref: string, kind: 'message' | 'event', body: string, createdAt: string, proposalId: number | null,
 *   authorName: string | null, paperTitle: string | null, original: string | null, text: string | null, unread: boolean,
 *   mention: boolean, chatTitle: string | null,
 *   noteRef?: string | null, noteWorkspace?: number | null, noteWorkspaceName?: string | null, noteWorkspaceKind?: 'personal' | 'group' | null
 *   markedId?: number | null, markedBody?: string | null
 * }} AppNotification
 * @typedef {'take' | 'work' | 'done'} Mark
 * @typedef {{
 *   sessions: number, activeMinutes: number, sessionMinutes: number, shortest: number, longest: number, average: number,
 *   reading: number, readingPerSession: number, listening: number, listeningPerSession: number, sections: Record<string, number>, devices: Record<string, number>, phones: Record<string, number>,
 *   messages: number, askedBook: number, tasks: number, supportTaken: number, supportDone: number, lastSeen: string | null
 * }} AnalyticsNumbers
 * @typedef {AnalyticsNumbers & { id: number, username: string, name: string, disabled: boolean, createdAt: string, lastSessionMinutes: number, firstSeen: string | null, perPeriod: Record<'week' | 'month' | 'quarter' | 'half' | 'year', number> }} AnalyticsPerson
 * @typedef {{ day: string, people: number, reading: number, listening: number }} AnalyticsDay
 * @typedef {{ id: number, written: string, alias: string, forms: Record<string, string>, note: string | null, source: string | null }} NameAlias
 * @typedef {{ days: number, since: string | null, totals: AnalyticsNumbers & { people: number, activePeople: number }, daily: AnalyticsDay[], people: AnalyticsPerson[] }} AnalyticsReport
 * @typedef {{ source: string, title: string, provider: string, url: string, enabled: boolean, intervalHours: number, version: number, lastRun: string | null, running: boolean }} SyncConfig
 * @typedef {{ id: number, trigger: 'manual' | 'schedule', status: 'ok' | 'unchanged' | 'error', versionFrom: number | null, versionTo: number | null, startedAt: string, finishedAt: string | null, summary: Record<string, any> }} SyncRun
 * @typedef {{ unread: number, queue: number }} NotificationCounts
 * @typedef {{ id: number, en: string, ru: string, avoid: string[], note: string | null, updatedAt: string, updatedBy: string | null }} GlossaryTerm
 * @typedef {{ kind: 'lost' | 'avoid', termId: number, message: string }} GlossaryWarning
 * @typedef {{ id: number, ref: string, original: string, text: string, status: ProposalStatus, exact: boolean }} MemoryHit
 * @typedef {{ warnings: GlossaryWarning[], terms: GlossaryTerm[], memory: MemoryHit[] }} AssistResult
 * @typedef {{
 *   id: number, workspaceId: number, title: string, description: string | null, shared: boolean, fragmentsOnly: boolean,
 *   authorId: number | null, authorName: string | null, workspaceName: string, workspaceKind: 'personal' | 'group',
 *   copiedFrom: number | null, createdAt: string, updatedAt: string, items: number
 * }} Collection
 * @typedef {{ ref: string, pageRef: string, ru: string, en: string, paperId: number, paperTitle: string }} CollectionParagraph
 * @typedef {{
 *   id: number, kind: 'para' | 'note' | 'text' | 'message', ref: string | null, refEnd: string | null, annotationId: number | null,
 *   message?: { id: number | null, authorName: string | null, createdAt: string | null, chat: string | null, text: string },
 *   body: string | null, heading: boolean, paragraphs?: CollectionParagraph[], collapsed: boolean,
 *   fragment: { lang: 'ru' | 'en', start: number, end: number, quote: string } | null,
 *   note?: {
 *     id: number, ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null, quote: string | null,
 *     color: NoteColor | null, bookmark: boolean, title: string | null, authorName: string | null,
 *     comments: { id: number, body: string, createdAt: string, authorName: string | null }[], tags: string[]
 *   } | null
 * }} CollectionItem
 * @typedef {Collection & { member: boolean, canEdit: boolean, subscribed: boolean, list: CollectionItem[] }} CollectionFull
 * @typedef {'todo' | 'doing' | 'done'} TaskStatus
 * @typedef {{
 *   id: number, title: string, notes: string | null, status: TaskStatus, important: boolean,
 *   due: string | null, tags: string[], ref: string | null, refEnd: string | null, annotationId: number | null,
 *   collectionId: number | null, collectionTitle: string | null, paperTitle: string | null, pos: number,
 *   messageId?: number | null, messageChat?: string | null, messageChatTitle?: string | null,
 *   doneAt: string | null, createdAt: string, updatedAt: string,
 *   subtasks: { id: number, title: string, done: boolean, pending?: 'wait', op?: string }[],
 *   uid?: string | null, pending?: 'wait'
 * }} Task
 * @typedef {Partial<Pick<Task, 'title' | 'notes' | 'status' | 'important' | 'due' | 'tags' | 'ref' | 'refEnd' | 'annotationId' | 'collectionId' | 'messageId'>>} TaskPatch
 * @typedef {{ kind: 'para', ref: string, refEnd?: string | null, body?: string | null, fragment?: { lang: 'ru' | 'en', start: number, end: number } }
 *   | { kind: 'note', annotationId: number, body?: string | null }
 *   | { kind: 'message', messageId: number, body?: string | null }
 *   | { kind: 'text', body: string, heading?: boolean }} NewCollectionItem
 * @typedef {{
 *   totals: Record<ProposalStatus, number>, paragraphs: number,
 *   byPaper: { id: number, title: string, paragraphs: number, changedParagraphs: number, approved: number, voting: number }[],
 *   people: { id: number, name: string, proposed: number, approved: number, votes: number, messages: number }[]
 * }} TranslationStats
 * @typedef {{ threshold: number, quorum: number, durationDays: number, authorCanVote: boolean, decideEarly: boolean }} VotingConfig
 * @typedef {{ id: number, name: string, kind: 'personal' | 'group', role: Role }} WorkspaceInfo
 * @typedef {{ userId: number, username: string, displayName: string | null, role: Role, joinedAt: string }} Member
 * @typedef {{ id: number, username: string, displayName: string | null, isAdmin: boolean, isTranslator: boolean, isCoordinator: boolean, disabled: boolean, hasPassword: boolean, createdAt: string,
 *   email: string | null, emailVerified: boolean }} AdminUser
 */

/** The workspace all workspace-scoped calls go to (set by lib/workspace.svelte.js). */
export const current = { ws: 1 };

/** Called on HTTP 401 so the app can show the login form. */
export const hooks = { unauthorized: () => {} };
outboxHooks.unauthorized = () => hooks.unauthorized();

/**
 * Every exchange with the server. A change that can wait goes to the device's queue (outbox.svelte.js:
 * sent in order, with or without a network now, never twice); the others are sent directly. A feature
 * in a folder of its own (web/src/features/) calls it from its own api.js.
 * @param {string} method @param {string} url @param {unknown} [body]
 */
export async function request(method, url, body) {
  const policy = method === 'GET' ? null : policyFor(method, url);
  if (policy?.mode === 'queue') return enqueue(method, url, body, policy);
  const path = `${method} ${url.split('?')[0]}`; // (for the journal: no query — searches stay private)
  const t0 = performance.now();
  /** @type {Response} */
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // (known to be offline: expected, not noted)
    if (policy?.mode !== 'drop' && navigator.onLine !== false) log('api', path, { failed: 'нет связи' }, 'warn');
    // (a reading falls back to what the device keeps; a change that needs the server says so)
    if (method !== 'GET') throw new Error('Нужна связь с сервером — попробуйте, когда она появится');
    throw err;
  }
  const ms = Math.round(performance.now() - t0);
  if (!res.ok && res.status !== 401) log('api', path, { status: res.status, ms }, res.status >= 500 ? 'error' : 'warn');
  else if (ms > 3000) log('api', path, { slow: ms }, 'warn');
  let cut = false;
  const data = await res.json().catch(() => ((cut = true), null));
  if (res.status === 401 && !url.startsWith('/api/auth/')) hooks.unauthorized();
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { status: res.status });
  // (the connection broke in the middle of the answer: not an empty answer, a failed one)
  if (cut) throw new Error('Ответ оборвался — проверьте связь');
  return data;
}

export const api = {
  /** @returns {Promise<Toc>} */
  toc: () => request('GET', '/api/toc'),
  /** The project's about.md. @returns {Promise<{ markdown: string }>} */
  about: () => request('GET', '/api/about'),
  /** @param {number} id @returns {Promise<PaperData>} */
  paper: (id) => request('GET', `/api/papers/${id}`),
  /**
   * The glossary's terms in a paper's paragraphs (the reader's pairs of terms): [id, en, ru] and, by
   * paragraph, the places in each language as flat triples start, end, id.
   * @param {number} id @returns {Promise<{ terms: [number, string, string][], paras: Record<string, { ru: number[], en: number[] }> }>}
   */
  paperTerms: (id) => request('GET', `/api/papers/${id}/terms`),
  /** @param {string} q @returns {Promise<{ path: string }>} */
  // (without a network these three are answered by the device itself: lib/offline-search.js)
  goto: (q) => orOnDevice(() => request('GET', `/api/goto?q=${encodeURIComponent(q)}`), { op: 'goto', text: q }),
  /** @returns {Promise<Workspace>} */
  workspace: () => request('GET', `/api/workspaces/${current.ws}`),
  /** @param {Partial<Settings>} patch @returns {Promise<Settings>} */
  saveSettings: (patch) => request('PUT', `/api/workspaces/${current.ws}/settings`, patch),

  /**
   * By the words — on the device too without a network; by meaning and the hybrid one — the server's model only.
   * @param {string} q @param {number} offset @param {'words' | 'meaning' | 'hybrid'} [mode] @returns {Promise<SearchResponse>}
   */
  search: (q, offset, mode = 'words') =>
    mode === 'words'
      ? orOnDevice(() => request('GET', `/api/search?ws=${current.ws}&q=${encodeURIComponent(q)}&offset=${offset}&limit=50`), { op: 'search', text: q, offset, limit: 50 })
      : request('GET', `/api/search?ws=${current.ws}&q=${encodeURIComponent(q)}&offset=${offset}&limit=50&mode=${mode}`),
  /** @param {string} q @param {number} paper @returns {Promise<Highlights>} */
  highlights: (q, paper) =>
    orOnDevice(() => request('GET', `/api/search/highlights?ws=${current.ws}&q=${encodeURIComponent(q)}&paper=${paper}`), { op: 'highlights', text: q, paper }),

  /** @returns {Promise<{ saved: SavedQuery[], recent: RecentQuery[] }>} */
  queries: () => request('GET', `/api/workspaces/${current.ws}/queries`),
  /** @param {string} title @param {string} query @returns {Promise<SavedQuery>} */
  saveQuery: (title, query) => request('POST', `/api/workspaces/${current.ws}/queries`, { title, query }),
  /** @param {number} id @param {{ title?: string, query?: string }} patch @returns {Promise<SavedQuery>} */
  updateQuery: (id, patch) => request('PUT', `/api/workspaces/${current.ws}/queries/${id}`, patch),
  /** @param {number} id */
  deleteQuery: (id) => request('DELETE', `/api/workspaces/${current.ws}/queries/${id}`),
  /** @param {string} query */
  addHistory: (query) => request('POST', `/api/workspaces/${current.ws}/history`, { query }),
  clearHistory: () => request('DELETE', `/api/workspaces/${current.ws}/history`),

  /** @param {number} [paper] @returns {Promise<Note[]>} */
  notes: (paper) => request('GET', `/api/workspaces/${current.ws}/annotations${paper === undefined ? '' : `?paper=${paper}`}`),
  /** @param {Record<string, unknown>} body @returns {Promise<Note>} */
  createNote: (body) => request('POST', `/api/workspaces/${current.ws}/annotations`, body),
  /** @param {NoteAddress} id @param {Record<string, unknown>} patch @returns {Promise<NoteResult>} */
  patchNote: (id, patch) => request('PATCH', `/api/workspaces/${current.ws}/annotations/${id}`, patch),
  /** @param {NoteAddress} id @returns {Promise<NoteResult>} */
  deleteNote: (id) => request('DELETE', `/api/workspaces/${current.ws}/annotations/${id}`),
  /** @param {NoteAddress} id @param {string} body @param {number | null} [replyTo] @returns {Promise<NoteResult>} */
  addComment: (id, body, replyTo = null) => request('POST', `/api/workspaces/${current.ws}/annotations/${id}/comments`, { body, replyTo }),
  /** @param {NoteAddress} id @param {number} cid @param {string} body @returns {Promise<NoteResult>} */
  editComment: (id, cid, body) => request('PATCH', `/api/workspaces/${current.ws}/annotations/${id}/comments/${cid}`, { body }),
  /** @param {NoteAddress} id @param {number} cid @returns {Promise<NoteResult>} */
  deleteComment: (id, cid) => request('DELETE', `/api/workspaces/${current.ws}/annotations/${id}/comments/${cid}`),
  /** @param {NoteAddress} id @param {string[]} tags @returns {Promise<NoteResult>} */
  setNoteTags: (id, tags) => request('PUT', `/api/workspaces/${current.ws}/annotations/${id}/tags`, { tags }),

  /** @returns {Promise<Tag[]>} */
  tags: () => request('GET', `/api/workspaces/${current.ws}/tags`),
  /** @param {{ name: string, color?: NoteColor | null, description?: string | null }} tag */
  putTag: (tag) => request('PUT', `/api/workspaces/${current.ws}/tags`, tag),
  /** @param {string} from @param {string} to @returns {Promise<{ renamed: number, merged: number }>} */
  renameTag: (from, to) => request('POST', `/api/workspaces/${current.ws}/tags/rename`, { from, to }),
  /** @param {string} name @param {boolean} subtree @returns {Promise<{ deleted: number }>} */
  deleteTag: (name, subtree) => request('POST', `/api/workspaces/${current.ws}/tags/delete`, { name, subtree }),

  // ---- Accounts ----
  /** @returns {Promise<{ user: User | null }>} */
  me: () => request('GET', '/api/auth/me'),
  /** @param {string} username @param {string} password @returns {Promise<{ user: User }>} */
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  /** `mail`: letters can be sent (the e-mail field, "Забыли пароль?"). @returns {Promise<{ open: boolean, mail: boolean }>} */
  registration: () => request('GET', '/api/auth/registration'),
  /** @param {{ username: string, displayName: string, password: string, website: string, email?: string }} body @returns {Promise<{ user: User, emailSent?: boolean }>} */
  register: (body) => request('POST', '/api/auth/register', body),
  /** A letter with a one-hour link to every account with this name or confirmed e-mail. @param {string} login */
  forgot: (login) => request('POST', '/api/auth/forgot', { login }),
  /** Sets (or, with '', removes) the e-mail; a new one gets a confirmation letter. @param {string} email @param {string} password @returns {Promise<{ user: User }>} */
  setEmail: (email, password) => request('PUT', '/api/auth/email', { email, password }),
  /** The name others see (empty — the login). @param {string} displayName @returns {Promise<{ user: User }>} */
  setProfile: (displayName) => request('PUT', '/api/auth/profile', { displayName }),
  resendEmail: () => request('POST', '/api/auth/email/resend'),
  /** @param {string} token @returns {Promise<{ email: string }>} */
  verifyEmail: (token) => request('POST', `/api/auth/verify-email/${encodeURIComponent(token)}`),
  /** @param {string} currentPassword @param {string} next */
  changePassword: (currentPassword, next) => request('POST', '/api/auth/password', { current: currentPassword, next }),
  /** @param {string} token @returns {Promise<{ kind: 'account' | 'reset', username: string | null, workspaceName: string | null, role: Role | null }>} */
  invite: (token) => request('GET', `/api/auth/invite/${encodeURIComponent(token)}`),
  /** @param {string} token @param {{ username?: string, displayName?: string, password: string }} body @returns {Promise<{ user: User }>} */
  acceptInvite: (token, body) => request('POST', `/api/auth/invite/${encodeURIComponent(token)}`, body),

  // ---- Workspaces and members (explicit ids: also used for workspaces other than the current one) ----
  /** @returns {Promise<WorkspaceInfo[]>} */
  workspaces: () => request('GET', '/api/workspaces'),
  /** @param {string} name @returns {Promise<WorkspaceInfo>} */
  createWorkspace: (name) => request('POST', '/api/workspaces', { name }),
  /** @param {number} id @param {string} name */
  renameWorkspace: (id, name) => request('PATCH', `/api/workspaces/${id}`, { name }),
  /** @param {number} id */
  deleteWorkspace: (id) => request('DELETE', `/api/workspaces/${id}`),
  /** @param {number} id @returns {Promise<Member[]>} */
  members: (id) => request('GET', `/api/workspaces/${id}/members`),
  /** @param {number} id @param {string} username @param {Role} role @returns {Promise<Member[]>} */
  addMember: (id, username, role) => request('POST', `/api/workspaces/${id}/members`, { username, role }),
  /** People of the platform the owner may add to the workspace. @param {number} id @returns {Promise<{ username: string, name: string }[]>} */
  workspaceCandidates: (id) => request('GET', `/api/workspaces/${id}/candidates`),
  /** @param {number} id @param {number} userId @param {Role} role @returns {Promise<Member[]>} */
  setMemberRole: (id, userId, role) => request('PATCH', `/api/workspaces/${id}/members/${userId}`, { role }),
  /** @param {number} id @param {number} userId */
  removeMember: (id, userId) => request('DELETE', `/api/workspaces/${id}/members/${userId}`),
  /** @param {number} id @param {Role} role @returns {Promise<{ url: string }>} */
  workspaceInvite: (id, role) => request('POST', `/api/workspaces/${id}/invites`, { role }),

  // ---- Administration ----
  /** @returns {Promise<AdminUser[]>} */
  adminUsers: () => request('GET', '/api/admin/users'),
  /** @param {boolean} open @returns {Promise<{ open: boolean }>} */
  adminSetRegistration: (open) => request('PUT', '/api/admin/registration', { open }),
  /** @param {boolean} isAdmin @returns {Promise<{ url: string }>} */
  adminInvite: (isAdmin) => request('POST', '/api/admin/invites', { isAdmin }),
  /** @param {number} userId @returns {Promise<{ url: string }>} */
  adminReset: (userId) => request('POST', `/api/admin/users/${userId}/reset`),
  /** @param {number} userId @param {{ disabled?: boolean, isAdmin?: boolean, isTranslator?: boolean, isCoordinator?: boolean }} patch */
  adminUpdate: (userId, patch) => request('PATCH', `/api/admin/users/${userId}`, patch),
  /** @returns {Promise<VotingConfig>} */
  adminVoting: () => request('GET', '/api/admin/voting'),
  /** @param {Partial<VotingConfig>} patch @returns {Promise<VotingConfig>} */
  /**
   * The devices' journal: sessions (newest first) with their events. @param {{ user?: number | null, failed?: boolean, before?: string | null }} f
   * @returns {Promise<{ people: { id: number, name: string, events: number, errors: number, lastAt: string }[], sessions: LogSession[] }>}
   */
  adminLog: (f) =>
    request('GET', `/api/admin/log?${new URLSearchParams({ ...(f.user ? { user: String(f.user) } : {}), ...(f.failed ? { failed: '1' } : {}), ...(f.before ? { before: f.before } : {}) })}`),
  /** @param {Partial<VotingConfig>} patch */
  adminSetVoting: (patch) => request('PUT', '/api/admin/voting', patch),

  // ---- Public layer: paragraph threads and translation proposals ----
  /** @returns {Promise<VotingConfig>} */
  votingConfig: () => request('GET', '/api/public/config'),
  /** @param {number} paper @returns {Promise<{ proposals: Proposal[], messages: Record<string, number> }>} */
  publicPaper: (paper) => request('GET', `/api/public/paper/${paper}`),
  /** A guest's (not signed in) numbers only. @param {number} paper @returns {Promise<{ proposals: Record<string, number>, messages: Record<string, number> }>} */
  guestPaper: (paper) => request('GET', `/api/guest/paper/${paper}`),
  /** @param {string} ref @returns {Promise<{ ref: string, proposals: Proposal[], messages: PublicMessage[], following: boolean }>} */
  thread: (ref) => request('GET', `/api/public/thread/${encodeURIComponent(ref)}`),
  /** @param {string} ref @param {boolean} follow @returns {Promise<{ following: boolean }>} */
  follow: (ref, follow) => request('POST', `/api/public/thread/${encodeURIComponent(ref)}/follow`, { follow }),

  /** @returns {Promise<ChatSummary[]>} */
  chats: () => request('GET', '/api/chat'),
  /** The user's pinned chats in order (up to 10). @param {string[]} keys @returns {Promise<{ pinned: string[] }>} */
  setPinnedChats: (keys) => request('PUT', '/api/chat/pinned', { keys }),
  /** @returns {Promise<{ unread: number, mentions: number }>} */
  chatUnread: () => request('GET', '/api/chat/unread'),
  /** @param {string} key @returns {Promise<ChatInfo>} */
  chatInfo: (key) => request('GET', `/api/chat/c/${encodeURIComponent(key)}`),
  /** @param {string} key @param {number} [before] @returns {Promise<PublicMessage[]>} */
  chatMessages: (key, before) => request('GET', `/api/chat/c/${encodeURIComponent(key)}/messages${before ? `?before=${before}` : ''}`),
  /** @param {string} key @param {string} body @param {number | null} [replyTo] @returns {Promise<PublicMessage>} */
  chatPost: (key, body, replyTo = null) => request('POST', `/api/chat/c/${encodeURIComponent(key)}/messages`, { body, replyTo }),
  /** @param {string} key @param {number} upTo */
  chatRead: (key, upTo) => request('POST', `/api/chat/c/${encodeURIComponent(key)}/read`, { upTo }),
  /** Pins a message (null unpins). @param {string} key @param {number | null} messageId @returns {Promise<{ pinned: PinnedMessage | null }>} */
  pinMessage: (key, messageId) => request('PUT', `/api/chat/c/${encodeURIComponent(key)}/pin`, { messageId }),
  /** @param {string} key */
  chatTyping: (key) => request('POST', `/api/chat/c/${encodeURIComponent(key)}/typing`),
  /** A minute of activity (analytics). @param {{ section: string, reading: boolean, listening: boolean, device: string, os: string }} beat */
  activity: (beat) => request('POST', '/api/activity', beat),
  /** Analytics (administrators); days: 7, 30, 90, … or 0 — all time. @param {number} days @returns {Promise<AnalyticsReport>} */
  analytics: (days) => request('GET', `/api/admin/analytics?days=${days}`),
  /** Integrations (administrators): the English text. @returns {Promise<{ config: SyncConfig, runs: SyncRun[] }>} */
  integration: () => request('GET', '/api/integrations/en'),
  /** @param {{ enabled?: boolean, intervalHours?: number, url?: string }} patch @returns {Promise<SyncConfig>} */
  saveIntegration: (patch) => request('PUT', '/api/integrations/en', patch),
  /** @returns {Promise<{ status: 'ok' | 'unchanged' | 'error' | 'busy', message?: string }>} */
  runIntegration: () => request('POST', '/api/integrations/en/run'),
  /** @param {string} key @param {boolean} muted @returns {Promise<{ muted: boolean }>} */
  muteChat: (key, muted) => request('PUT', `/api/chat/c/${encodeURIComponent(key)}/mute`, { muted }),
  /** The Book's voice (administrators). @returns {Promise<{ paused: boolean, lastDay: string | null, hour: number }>} */
  voiceStatus: () => request('GET', '/api/chat/voice'),
  /** @returns {Promise<{ channelId: number, discussionId: number | null, ref: string }>} */
  voicePost: () => request('POST', '/api/chat/voice/post'),
  /** @param {boolean} paused @returns {Promise<{ paused: boolean, lastDay: string | null, hour: number }>} */
  voicePause: (paused) => request('PUT', '/api/chat/voice', { paused }),
  /** An administrator's mark (null takes it off). @param {number} id @param {Mark | null} mark @returns {Promise<PublicMessage>} */
  markMessage: (id, mark) => request('PUT', `/api/chat/messages/${id}/mark`, { mark }),
  /** The search in one conversation. @param {string} key @param {string} q @param {Mark | null} mark @returns {Promise<PublicMessage[]>} */
  chatSearch: (key, q, mark) => request('GET', `/api/chat/c/${encodeURIComponent(key)}/search?q=${encodeURIComponent(q)}${mark ? `&mark=${mark}` : ''}`),
  /** Marked messages from the chats one may read (no mark — all). @param {Mark | null} mark @returns {Promise<PublicMessage[]>} */
  markedMessages: (mark) => request('GET', `/api/chat/marked${mark ? `?mark=${mark}` : ''}`),
  /** @param {number} id @param {string} emoji @returns {Promise<{ reactions: Reaction[] }>} */
  react: (id, emoji) => request('POST', `/api/chat/messages/${id}/react`, { emoji }),
  /** Whom to mention; with `key` of a members-only chat — its members only. @param {string} q @param {string | null} [key] @returns {Promise<{ id: number, username: string, name: string }[]>} */
  chatUsers: (q, key = null) => request('GET', `/api/chat/users?q=${encodeURIComponent(q)}${key ? `&key=${encodeURIComponent(key)}` : ''}`),
  /** @param {string} title @param {string | null} description @returns {Promise<{ id: number }>} */
  createChannel: (title, description) => request('POST', '/api/chat/channels', { title, description }),
  /** @param {number} id @param {{ title?: string, description?: string | null, archived?: boolean }} patch */
  updateChannel: (id, patch) => request('PATCH', `/api/chat/channels/${id}`, patch),

  /** @returns {Promise<{ tasks: Task[] }>} */
  tasks: () => request('GET', '/api/tasks'),
  /** @param {string} today @returns {Promise<{ due: number }>} */
  taskCount: (today) => request('GET', `/api/tasks/count?today=${today}`),
  /** @param {TaskPatch & { title: string }} task @returns {Promise<Task>} */
  createTask: (task) => request('POST', '/api/tasks', task),
  /** @param {number} id @param {TaskPatch} patch @returns {Promise<Task>} */
  patchTask: (id, patch) => request('PATCH', `/api/tasks/${id}`, patch),
  /** @param {number} id */
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
  /** @param {number[]} ids */
  orderTasks: (ids) => request('PUT', '/api/tasks/order', { ids }),
  /** @param {number} id @param {string} title @returns {Promise<Task>} */
  addSubtask: (id, title) => request('POST', `/api/tasks/${id}/subtasks`, { title }),
  /** @param {number} id @param {number} sid @param {{ title?: string, done?: boolean }} patch @returns {Promise<Task>} */
  patchSubtask: (id, sid, patch) => request('PATCH', `/api/tasks/${id}/subtasks/${sid}`, patch),
  /** @param {number} id @param {number} sid @returns {Promise<Task>} */
  deleteSubtask: (id, sid) => request('DELETE', `/api/tasks/${id}/subtasks/${sid}`),

  /** @returns {Promise<{ own: Collection[], subscribed: Collection[] }>} */
  collections: () => request('GET', `/api/workspaces/${current.ws}/collections`),
  /** @returns {Promise<Collection[]>} */
  sharedCollections: () => request('GET', '/api/collections/shared'),
  /** @param {string} title @returns {Promise<Collection>} */
  createCollection: (title) => request('POST', `/api/workspaces/${current.ws}/collections`, { title }),
  /** @param {number} id @returns {Promise<CollectionFull>} */
  collection: (id) => request('GET', `/api/collections/${id}`),
  /** @param {number} id @param {{ title?: string, description?: string | null, shared?: boolean, fragmentsOnly?: boolean }} patch @returns {Promise<Collection>} */
  updateCollection: (id, patch) => request('PATCH', `/api/collections/${id}`, patch),
  /** @param {number} id */
  deleteCollection: (id) => request('DELETE', `/api/collections/${id}`),
  /** @param {number} id @param {NewCollectionItem & { after?: number | null }} item @returns {Promise<{ id: number }>} */
  addCollectionItem: (id, item) => request('POST', `/api/collections/${id}/items`, item),
  /** @param {number} id @param {number} itemId @param {{ body?: string | null, heading?: boolean, collapsed?: boolean }} patch */
  editCollectionItem: (id, itemId, patch) => request('PATCH', `/api/collections/${id}/items/${itemId}`, patch),
  /** @param {number} id @param {number} itemId */
  deleteCollectionItem: (id, itemId) => request('DELETE', `/api/collections/${id}/items/${itemId}`),
  /** @param {number} id @param {number[]} ids */
  orderCollection: (id, ids) => request('PUT', `/api/collections/${id}/order`, { ids }),
  /** @param {number} id @param {boolean} subscribed @returns {Promise<{ subscribed: boolean }>} */
  subscribeCollection: (id, subscribed) => request('POST', `/api/collections/${id}/subscribe`, { subscribed }),
  /** @param {number} id @returns {Promise<Collection>} */
  copyCollection: (id) => request('POST', `/api/collections/${id}/copy`, { workspaceId: current.ws }),

  /** @returns {Promise<TranslationStats>} */
  stats: () => request('GET', '/api/public/stats'),
  /** @returns {Promise<GlossaryTerm[]>} */
  glossary: () => request('GET', '/api/glossary'),
  /** @param {{ en: string, ru: string, avoid: string[], note: string | null }} term @returns {Promise<{ id: number }>} */
  createTerm: (term) => request('POST', '/api/glossary', term),
  /** @param {number} id @param {{ en: string, ru: string, avoid: string[], note: string | null }} term */
  updateTerm: (id, term) => request('PATCH', `/api/glossary/${id}`, term),
  /** @param {number} id */
  deleteTerm: (id) => request('DELETE', `/api/glossary/${id}`),
  /** @returns {Promise<Pronunciation[]>} */
  pronunciations: () => request('GET', '/api/pronunciations'),
  /** @param {Omit<Pronunciation, 'id'>} p @returns {Promise<{ id: number }>} */
  createPronunciation: (p) => request('POST', '/api/pronunciations', p),
  /** @param {number} id @param {Omit<Pronunciation, 'id'>} p */
  updatePronunciation: (id, p) => request('PATCH', `/api/pronunciations/${id}`, p),
  /** @param {number} id */
  deletePronunciation: (id) => request('DELETE', `/api/pronunciations/${id}`),
  /** The dictionary of names. @returns {Promise<NameAlias[]>} */
  aliases: () => request('GET', '/api/aliases'),
  /** @param {Omit<NameAlias, 'id'>} a @returns {Promise<{ id: number }>} */
  createAlias: (a) => request('POST', '/api/aliases', a),
  /** @param {number} id @param {Omit<NameAlias, 'id'>} a */
  updateAlias: (id, a) => request('PATCH', `/api/aliases/${id}`, a),
  /** @param {number} id */
  deleteAlias: (id) => request('DELETE', `/api/aliases/${id}`),
  /** The recorded reading: its files by language (a file per section of a paper). @returns {Promise<Record<string, { paper: number, sections: number[], file: string, duration?: number }[]>>} */
  audio: () => request('GET', '/api/audio'),
  /**
   * Hints for the translation editor.
   * @param {{ ref: string, start: number, end: number, text?: string, proposalId?: number | null }} body
   * @returns {Promise<AssistResult>}
   */
  assist: (body) => request('POST', '/api/public/assist', body),

  /** @returns {Promise<NotificationCounts>} */
  notificationCount: () => request('GET', '/api/notifications/count'),
  /** @returns {Promise<NotificationCounts & { items: AppNotification[] }>} */
  notifications: () => request('GET', '/api/notifications'),
  /** @returns {Promise<NotificationCounts>} */
  notificationsSeen: () => request('POST', '/api/notifications/seen'),
  /** @param {'queue' | 'mine' | 'voting' | 'approved'} scope @returns {Promise<Proposal[]>} */
  proposals: (scope) => request('GET', `/api/public/proposals?scope=${scope}`),
  /** @param {string} ref @param {string} body @param {number | null} [proposalId] @param {number | null} [replyTo] */
  postMessage: (ref, body, proposalId = null, replyTo = null) =>
    request('POST', `/api/public/thread/${encodeURIComponent(ref)}/messages`, { body, proposalId, replyTo }),
  /** @param {number} id @param {string} body */
  editMessage: (id, body) => request('PATCH', `/api/public/messages/${id}`, { body }),
  /** @param {number} id */
  deleteMessage: (id) => request('DELETE', `/api/public/messages/${id}`),
  /** @param {number} id @param {boolean} hidden */
  hideMessage: (id, hidden) => request('POST', `/api/public/messages/${id}/hide`, { hidden }),
  /** @param {{ ref: string, start: number, end: number, text: string, note?: string }} body @returns {Promise<Proposal>} */
  createProposal: (body) => request('POST', '/api/public/proposals', body),
  /** @param {number} id @param {{ text?: string, note?: string | null }} patch @returns {Promise<Proposal>} */
  editProposal: (id, patch) => request('PATCH', `/api/public/proposals/${id}`, patch),
  /** @param {number} id */
  deleteProposal: (id) => request('DELETE', `/api/public/proposals/${id}`),
  /** @param {number} id @returns {Promise<Proposal>} */
  publishProposal: (id) => request('POST', `/api/public/proposals/${id}/publish`),
  /** @param {number} id @returns {Promise<Proposal>} */
  withdrawProposal: (id) => request('POST', `/api/public/proposals/${id}/withdraw`),
  /** @param {number} id @param {-1 | 0 | 1 | null} value @returns {Promise<Proposal>} */
  vote: (id, value) => request('POST', `/api/public/proposals/${id}/vote`, { value }),
  /** @param {number} id @param {'unpublish' | 'reject'} action @param {string} [note] */
  moderate: (id, action, note) => request('POST', `/api/public/proposals/${id}/moderate`, { action, note }),
};
