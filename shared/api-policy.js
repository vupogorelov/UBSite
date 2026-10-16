// @ts-check
// How each address of the API behaves without a network, in one list — grouped by feature. Read by:
//   the service worker (web/public/sw.js: the build turns this file into /api-policy.js for it — keep it
//   free of imports), the device's queue (web/src/lib/outbox.svelte.js), and the server's test that holds
//   every route to it (server/api-policy.test.js: no rule without a route; the map of routes reviewed).
//
// Reads (GET):
//   'text' — the book's text: the device's copy first (a paper opens at once), the network for what it lacks;
//   'book' — the rest of the book (editable): the network first, the device's copy when it fails;
//   'live' — never from a cache: streams, files, the copy itself, search, the feeds;
//   'last' — (any other) the network first, its last answer kept for when it fails.
// Changes (POST, PUT, PATCH, DELETE):
//   'queue' — waits in the device's queue and is sent in order, with or without a network now; `kind`
//             names it ("Ждут отправки"), `merge` — a newer change of the same thing replaces the waiting
//             one ('replace') or adds to it ('patch');
//   'drop'  — means nothing later: not kept, not retried;
//   'direct' — (any other) needs the server at the moment: without a network it says so.

/** @typedef {'text' | 'book' | 'live' | 'last'} ReadMode */
/** @typedef {'message' | 'read' | 'mute' | 'pinned' | 'settings' | 'history' | 'note' | 'task' | 'react' | 'mark' | 'pin' | 'follow'} Kind */
/** @typedef {{ mode: 'queue', kind: Kind, merge?: 'replace' | 'patch' } | { mode: 'drop' } | { mode: 'direct' }} WritePolicy */

/** @type {[mode: Exclude<ReadMode, 'last'>, path: RegExp, feature: string][]} */
const READS = [
  // the book
  ['text', /^\/api\/(toc|papers\/\d+)$/, 'book'],
  ['book', /^\/api\/(glossary|pronunciations|stem-aliases|papers\/\d+\/terms)$/, 'book'],
  ['live', /^\/api\/offline\//, 'offline'],
  ['live', /^\/api\/audio\//, 'audio'],
  ['live', /^\/api\/export/, 'export'],
  ['live', /^\/api\/search/, 'search'],
  // the feeds of changes and the live stream
  ['live', /^\/api\/workspaces\/\d+\/changes$/, 'notes'],
  ['live', /^\/api\/tasks\/changes$/, 'tasks'],
  ['live', /^\/api\/chat\/stream$/, 'chat'],
  // is the server alive: a kept "ok" would say so when it is not
  ['live', /^\/api\/health$/, 'health'],
];

/** @type {[method: string, path: RegExp, policy: WritePolicy, feature: string][]} */
const WRITES = [
  // chat: messages, read marks, mute, pinned chats, reactions, the administrator's mark, the pinned message
  ['POST', /^\/api\/chat\/c\/[^/]+\/messages$/, { mode: 'queue', kind: 'message' }, 'chat'],
  ['POST', /^\/api\/chat\/c\/[^/]+\/read$/, { mode: 'queue', kind: 'read', merge: 'replace' }, 'chat'],
  ['PUT', /^\/api\/chat\/c\/[^/]+\/mute$/, { mode: 'queue', kind: 'mute', merge: 'replace' }, 'chat'],
  ['PUT', /^\/api\/chat\/pinned$/, { mode: 'queue', kind: 'pinned', merge: 'replace' }, 'chat'],
  ['POST', /^\/api\/chat\/messages\/\d+\/react$/, { mode: 'queue', kind: 'react' }, 'chat'], // (a toggle each: in order, not merged)
  ['PUT', /^\/api\/chat\/messages\/\d+\/mark$/, { mode: 'queue', kind: 'mark', merge: 'replace' }, 'chat'],
  ['PUT', /^\/api\/chat\/c\/[^/]+\/pin$/, { mode: 'queue', kind: 'pin', merge: 'replace' }, 'chat'],
  ['POST', /^\/api\/chat\/c\/[^/]+\/typing$/, { mode: 'drop' }, 'chat'],
  // the public layer: following a paragraph's thread
  ['POST', /^\/api\/public\/thread\/[^/]+\/follow$/, { mode: 'queue', kind: 'follow', merge: 'replace' }, 'public'],
  // the workspace's settings and search history
  ['PUT', /^\/api\/workspaces\/\d+\/settings$/, { mode: 'queue', kind: 'settings', merge: 'patch' }, 'workspaces'],
  ['POST', /^\/api\/workspaces\/\d+\/history$/, { mode: 'queue', kind: 'history' }, 'workspaces'],
  // notes, bookmarks, their comments and tags (shown at once: notes.svelte.js lays them over what the server knows)
  ['POST', /^\/api\/workspaces\/\d+\/annotations$/, { mode: 'queue', kind: 'note' }, 'notes'],
  ['PATCH', /^\/api\/workspaces\/\d+\/annotations\/[^/]+$/, { mode: 'queue', kind: 'note' }, 'notes'],
  ['DELETE', /^\/api\/workspaces\/\d+\/annotations\/[^/]+$/, { mode: 'queue', kind: 'note' }, 'notes'],
  ['PUT', /^\/api\/workspaces\/\d+\/annotations\/[^/]+\/tags$/, { mode: 'queue', kind: 'note' }, 'notes'],
  ['POST', /^\/api\/workspaces\/\d+\/annotations\/[^/]+\/comments$/, { mode: 'queue', kind: 'note' }, 'notes'],
  ['PATCH', /^\/api\/workspaces\/\d+\/annotations\/[^/]+\/comments\/\d+$/, { mode: 'queue', kind: 'note' }, 'notes'],
  ['DELETE', /^\/api\/workspaces\/\d+\/annotations\/[^/]+\/comments\/\d+$/, { mode: 'queue', kind: 'note' }, 'notes'],
  // tasks and subtasks (tasks.svelte.js lays them over what the server knows, as notes)
  ['POST', /^\/api\/tasks$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  ['PUT', /^\/api\/tasks\/order$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  ['PATCH', /^\/api\/tasks\/[^/]+$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  ['DELETE', /^\/api\/tasks\/[^/]+$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  ['POST', /^\/api\/tasks\/[^/]+\/subtasks$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  ['PATCH', /^\/api\/tasks\/[^/]+\/subtasks\/\d+$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  ['DELETE', /^\/api\/tasks\/[^/]+\/subtasks\/\d+$/, { mode: 'queue', kind: 'task' }, 'tasks'],
  // analytics: a minute of activity
  ['POST', /^\/api\/activity$/, { mode: 'drop' }, 'analytics'],
];

/** How a read of `path` (no query) behaves without a network. @param {string} path @returns {ReadMode} */
function readPolicy(path) {
  return READS.find(([, re]) => re.test(path))?.[0] ?? 'last';
}

/** How a change behaves without a network. @param {string} method @param {string} path (no query) @returns {WritePolicy} */
function writePolicy(method, path) {
  return WRITES.find(([m, re]) => m === method && re.test(path))?.[2] ?? { mode: 'direct' };
}

/** The rules themselves (for the server's test). */
const API_RULES = { READS, WRITES };

export { readPolicy, writePolicy, API_RULES };
