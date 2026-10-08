// @ts-check

/**
 * @typedef {{ id: number, titleRu: string, titleEn: string, subtitleRu: string | null }} Part
 * @typedef {{ id: number, partId: number, titleRu: string, titleEn: string, paragraphs?: number }} PaperInfo
 * @typedef {{ id: number, lang: 'ru' | 'en', written: string, spoken: string }} Pronunciation
 * @typedef {{ paperId: number, num: number, titleRu: string, titleEn: string }} TocSection
 * @typedef {{ parts: Part[], papers: PaperInfo[], sections: TocSection[] }} Toc
 * @typedef {{ ref: string, sectionNum: number, pageRef: string, ru: string, en: string }} Paragraph
 * @typedef {{
 *   paper: PaperInfo & { partTitleRu: string },
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
 * @typedef {{ id: number, body: string, createdAt: string, updatedAt: string, authorId: number | null, authorName: string | null }} NoteComment
 * @typedef {{
 *   id: number, ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null, quote: string | null,
 *   color: NoteColor | null, bookmark: boolean, title: string | null, resolved: boolean,
 *   createdAt: string, updatedAt: string, paperId: number | null, sectionNum: number | null, paperTitle: string | null,
 *   authorId: number | null, authorName: string | null, comments: NoteComment[], tags: string[]
 * }} Note
 * @typedef {{ name: string, color: NoteColor | null, description: string | null, count: number }} Tag
 * @typedef {Note | { id: number, deleted: true }} NoteResult
 * @typedef {'owner' | 'editor' | 'commenter' | 'viewer'} Role
 * @typedef {{ id: number, username: string, displayName: string | null, isAdmin: boolean, isTranslator: boolean, isCoordinator: boolean }} User
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
 *   replyTo?: number | null, reply?: { id: number, authorName: string | null, body: string } | null, reactions?: Reaction[]
 * }} PublicMessage
 * @typedef {{
 *   key: string, kind: 'para' | 'chan' | 'ws', title: string, subtitle: string | null, members?: number,
 *   last: PublicMessage | null, unread: number, mentions: number
 * }} ChatSummary
 * @typedef {{
 *   key: string, kind: 'para' | 'chan' | 'ws', title: string, subtitle: string | null, members?: number, archived?: boolean, text?: string,
 *   post?: { ru: string, en: string, pageRef: string, paperId: number, paperTitle: string } | null
 * }} ChatInfo
 * @typedef {{
 *   id: number, ref: string, kind: 'message' | 'event', body: string, createdAt: string, proposalId: number | null,
 *   authorName: string | null, paperTitle: string | null, original: string | null, text: string | null, unread: boolean,
 *   mention: boolean, chatTitle: string | null
 * }} AppNotification
 * @typedef {{ unread: number, queue: number }} NotificationCounts
 * @typedef {{ id: number, en: string, ru: string, avoid: string[], note: string | null, updatedAt: string, updatedBy: string | null }} GlossaryTerm
 * @typedef {{ kind: 'lost' | 'avoid', termId: number, message: string }} GlossaryWarning
 * @typedef {{ id: number, ref: string, original: string, text: string, status: ProposalStatus, exact: boolean }} MemoryHit
 * @typedef {{ warnings: GlossaryWarning[], terms: GlossaryTerm[], memory: MemoryHit[] }} AssistResult
 * @typedef {{
 *   id: number, workspaceId: number, title: string, description: string | null, shared: boolean,
 *   authorId: number | null, authorName: string | null, workspaceName: string, workspaceKind: 'personal' | 'group',
 *   copiedFrom: number | null, createdAt: string, updatedAt: string, items: number
 * }} Collection
 * @typedef {{ ref: string, pageRef: string, ru: string, en: string, paperId: number, paperTitle: string }} CollectionParagraph
 * @typedef {{
 *   id: number, kind: 'para' | 'note' | 'text', ref: string | null, refEnd: string | null, annotationId: number | null,
 *   body: string | null, heading: boolean, paragraphs?: CollectionParagraph[],
 *   note?: {
 *     id: number, ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null, quote: string | null,
 *     color: NoteColor | null, bookmark: boolean, title: string | null, authorName: string | null,
 *     comments: { id: number, body: string, createdAt: string, authorName: string | null }[], tags: string[]
 *   } | null
 * }} CollectionItem
 * @typedef {Collection & { member: boolean, canEdit: boolean, subscribed: boolean, list: CollectionItem[] }} CollectionFull
 * @typedef {'todo' | 'doing' | 'done'} TaskStatus
 * @typedef {{ id: number, title: string, emoji: string | null, pos: number }} TaskList
 * @typedef {{
 *   id: number, listId: number | null, title: string, notes: string | null, status: TaskStatus, important: boolean,
 *   due: string | null, tags: string[], ref: string | null, refEnd: string | null, annotationId: number | null,
 *   collectionId: number | null, collectionTitle: string | null, paperTitle: string | null, pos: number,
 *   doneAt: string | null, createdAt: string, updatedAt: string, subtasks: { id: number, title: string, done: boolean }[]
 * }} Task
 * @typedef {Partial<Pick<Task, 'listId' | 'title' | 'notes' | 'status' | 'important' | 'due' | 'tags' | 'ref' | 'refEnd' | 'annotationId' | 'collectionId'>>} TaskPatch
 * @typedef {{ kind: 'para', ref: string, refEnd?: string | null, body?: string | null }
 *   | { kind: 'note', annotationId: number, body?: string | null }
 *   | { kind: 'text', body: string, heading?: boolean }} NewCollectionItem
 * @typedef {{
 *   totals: Record<ProposalStatus, number>, paragraphs: number,
 *   byPaper: { id: number, title: string, paragraphs: number, changedParagraphs: number, approved: number, voting: number }[],
 *   people: { id: number, name: string, proposed: number, approved: number, votes: number, messages: number }[]
 * }} TranslationStats
 * @typedef {{ threshold: number, quorum: number, durationDays: number, authorCanVote: boolean, decideEarly: boolean }} VotingConfig
 * @typedef {{ id: number, name: string, kind: 'personal' | 'group', role: Role }} WorkspaceInfo
 * @typedef {{ userId: number, username: string, displayName: string | null, role: Role, joinedAt: string }} Member
 * @typedef {{ id: number, username: string, displayName: string | null, isAdmin: boolean, isTranslator: boolean, isCoordinator: boolean, disabled: boolean, hasPassword: boolean, createdAt: string }} AdminUser
 */

/** The workspace all workspace-scoped calls go to (set by lib/workspace.svelte.js). */
export const current = { ws: 1 };

/** Called on HTTP 401 so the app can show the login form. */
export const hooks = { unauthorized: () => {} };

/** @param {string} method @param {string} url @param {unknown} [body] */
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && !url.startsWith('/api/auth/')) hooks.unauthorized();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  /** @returns {Promise<Toc>} */
  toc: () => request('GET', '/api/toc'),
  /** The project's about.md. @returns {Promise<{ markdown: string }>} */
  about: () => request('GET', '/api/about'),
  /** @param {number} id @returns {Promise<PaperData>} */
  paper: (id) => request('GET', `/api/papers/${id}`),
  /** @param {string} q @returns {Promise<{ path: string }>} */
  goto: (q) => request('GET', `/api/goto?q=${encodeURIComponent(q)}`),
  /** @returns {Promise<Workspace>} */
  workspace: () => request('GET', `/api/workspaces/${current.ws}`),
  /** @param {Partial<Settings>} patch @returns {Promise<Settings>} */
  saveSettings: (patch) => request('PUT', `/api/workspaces/${current.ws}/settings`, patch),

  /** @param {string} q @param {number} offset @returns {Promise<SearchResponse>} */
  search: (q, offset) => request('GET', `/api/search?ws=${current.ws}&q=${encodeURIComponent(q)}&offset=${offset}&limit=50`),
  /** @param {string} q @param {number} paper @returns {Promise<Highlights>} */
  highlights: (q, paper) => request('GET', `/api/search/highlights?ws=${current.ws}&q=${encodeURIComponent(q)}&paper=${paper}`),

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
  /** @param {number} id @param {Record<string, unknown>} patch @returns {Promise<NoteResult>} */
  patchNote: (id, patch) => request('PATCH', `/api/workspaces/${current.ws}/annotations/${id}`, patch),
  /** @param {number} id @returns {Promise<NoteResult>} */
  deleteNote: (id) => request('DELETE', `/api/workspaces/${current.ws}/annotations/${id}`),
  /** @param {number} id @param {string} body @returns {Promise<NoteResult>} */
  addComment: (id, body) => request('POST', `/api/workspaces/${current.ws}/annotations/${id}/comments`, { body }),
  /** @param {number} id @param {number} cid @param {string} body @returns {Promise<NoteResult>} */
  editComment: (id, cid, body) => request('PATCH', `/api/workspaces/${current.ws}/annotations/${id}/comments/${cid}`, { body }),
  /** @param {number} id @param {number} cid @returns {Promise<NoteResult>} */
  deleteComment: (id, cid) => request('DELETE', `/api/workspaces/${current.ws}/annotations/${id}/comments/${cid}`),
  /** @param {number} id @param {string[]} tags @returns {Promise<NoteResult>} */
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
  /** @param {number} id @param {number} userId @param {Role} role @returns {Promise<Member[]>} */
  setMemberRole: (id, userId, role) => request('PATCH', `/api/workspaces/${id}/members/${userId}`, { role }),
  /** @param {number} id @param {number} userId */
  removeMember: (id, userId) => request('DELETE', `/api/workspaces/${id}/members/${userId}`),
  /** @param {number} id @param {Role} role @returns {Promise<{ url: string }>} */
  workspaceInvite: (id, role) => request('POST', `/api/workspaces/${id}/invites`, { role }),

  // ---- Administration ----
  /** @returns {Promise<AdminUser[]>} */
  adminUsers: () => request('GET', '/api/admin/users'),
  /** @param {boolean} isAdmin @returns {Promise<{ url: string }>} */
  adminInvite: (isAdmin) => request('POST', '/api/admin/invites', { isAdmin }),
  /** @param {number} userId @returns {Promise<{ url: string }>} */
  adminReset: (userId) => request('POST', `/api/admin/users/${userId}/reset`),
  /** @param {number} userId @param {{ disabled?: boolean, isAdmin?: boolean, isTranslator?: boolean, isCoordinator?: boolean }} patch */
  adminUpdate: (userId, patch) => request('PATCH', `/api/admin/users/${userId}`, patch),
  /** @returns {Promise<VotingConfig>} */
  adminVoting: () => request('GET', '/api/admin/voting'),
  /** @param {Partial<VotingConfig>} patch @returns {Promise<VotingConfig>} */
  adminSetVoting: (patch) => request('PUT', '/api/admin/voting', patch),

  // ---- Public layer: paragraph threads and translation proposals ----
  /** @returns {Promise<VotingConfig>} */
  votingConfig: () => request('GET', '/api/public/config'),
  /** @param {number} paper @returns {Promise<{ proposals: Proposal[], messages: Record<string, number> }>} */
  publicPaper: (paper) => request('GET', `/api/public/paper/${paper}`),
  /** @param {string} ref @returns {Promise<{ ref: string, proposals: Proposal[], messages: PublicMessage[], following: boolean }>} */
  thread: (ref) => request('GET', `/api/public/thread/${encodeURIComponent(ref)}`),
  /** @param {string} ref @param {boolean} follow @returns {Promise<{ following: boolean }>} */
  follow: (ref, follow) => request('POST', `/api/public/thread/${encodeURIComponent(ref)}/follow`, { follow }),

  /** @returns {Promise<ChatSummary[]>} */
  chats: () => request('GET', '/api/chat'),
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
  /** @param {string} key */
  chatTyping: (key) => request('POST', `/api/chat/c/${encodeURIComponent(key)}/typing`),
  /** @param {number} id @param {string} emoji @returns {Promise<{ reactions: Reaction[] }>} */
  react: (id, emoji) => request('POST', `/api/chat/messages/${id}/react`, { emoji }),
  /** @param {string} q @returns {Promise<{ id: number, username: string, name: string }[]>} */
  chatUsers: (q) => request('GET', `/api/chat/users?q=${encodeURIComponent(q)}`),
  /** @param {string} title @param {string | null} description @returns {Promise<{ id: number }>} */
  createChannel: (title, description) => request('POST', '/api/chat/channels', { title, description }),
  /** @param {number} id @param {{ title?: string, description?: string | null, archived?: boolean }} patch */
  updateChannel: (id, patch) => request('PATCH', `/api/chat/channels/${id}`, patch),

  /** @returns {Promise<{ lists: TaskList[], tasks: Task[] }>} */
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
  /** @param {string} title @param {string | null} emoji @returns {Promise<{ id: number }>} */
  createTaskList: (title, emoji) => request('POST', '/api/task-lists', { title, emoji }),
  /** @param {number} id @param {{ title?: string, emoji?: string | null }} patch */
  updateTaskList: (id, patch) => request('PATCH', `/api/task-lists/${id}`, patch),
  /** @param {number} id */
  deleteTaskList: (id) => request('DELETE', `/api/task-lists/${id}`),

  /** @returns {Promise<{ own: Collection[], subscribed: Collection[] }>} */
  collections: () => request('GET', `/api/workspaces/${current.ws}/collections`),
  /** @returns {Promise<Collection[]>} */
  sharedCollections: () => request('GET', '/api/collections/shared'),
  /** @param {string} title @returns {Promise<Collection>} */
  createCollection: (title) => request('POST', `/api/workspaces/${current.ws}/collections`, { title }),
  /** @param {number} id @returns {Promise<CollectionFull>} */
  collection: (id) => request('GET', `/api/collections/${id}`),
  /** @param {number} id @param {{ title?: string, description?: string | null, shared?: boolean }} patch @returns {Promise<Collection>} */
  updateCollection: (id, patch) => request('PATCH', `/api/collections/${id}`, patch),
  /** @param {number} id */
  deleteCollection: (id) => request('DELETE', `/api/collections/${id}`),
  /** @param {number} id @param {NewCollectionItem & { after?: number | null }} item @returns {Promise<{ id: number }>} */
  addCollectionItem: (id, item) => request('POST', `/api/collections/${id}/items`, item),
  /** @param {number} id @param {number} itemId @param {{ body?: string | null, heading?: boolean }} patch */
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
