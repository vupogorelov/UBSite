// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { registerWorkspaceRoutes } from './api/workspaces.js';

function setup() {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO users (id, username, username_key, display_name) VALUES
      (1, 'owner', 'owner', 'Владелец'), (2, 'irina', 'irina', 'Ирина'), (3, 'oleg', 'oleg', NULL), (4, 'gone', 'gone', NULL);
    INSERT INTO users (id, username, username_key, is_agent) VALUES (5, 'book', 'book', 1);
    UPDATE users SET disabled = 1 WHERE id = 4;
    INSERT INTO workspaces (id, name, kind) VALUES (10, 'Группа', 'group'), (11, 'Личное', 'personal');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (10, 1, 'owner'), (10, 3, 'viewer'), (11, 1, 'owner');
  `);
  const router = createRouter();
  registerWorkspaceRoutes(router, db, createAuth(db));
  const users = { 1: { id: 1, username: 'owner' }, 3: { id: 3, username: 'oleg' } };
  /** @param {string} method @param {string} path @param {1 | 3} uid @param {unknown} [body] */
  const call = async (method, path, uid, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: /** @type {any} */ (users[uid]) }));
  };
  return { call };
}

test('workspaces: the owner picks whom to add from the people of the platform', async () => {
  const { call } = setup();
  const people = async (/** @type {1 | 3} */ uid) => (await call('GET', '/api/workspaces/10/candidates', uid)).map((/** @type {any} */ x) => ({ ...x }));
  // not members yet, active, not the Book's voice; by name
  assert.deepEqual(await people(1), [{ username: 'irina', name: 'Ирина' }]);
  await call('POST', '/api/workspaces/10/members', 1, { username: 'irina', role: 'editor' });
  assert.deepEqual(await people(1), []);
  // only the owner, only a group
  await assert.rejects(call('GET', '/api/workspaces/10/candidates', 3), /прав|доступ|владел/i);
  await assert.rejects(call('GET', '/api/workspaces/11/candidates', 1), /личное/i);
});
