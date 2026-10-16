// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createLive } from './live.js';

test("live changes: a workspace's notes told to its members, a task to its owner alone; nothing new — nothing said", () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO users (id, username, username_key) VALUES (1, 'anna', 'anna'), (2, 'boris', 'boris'), (3, 'vera', 'vera');
    INSERT INTO workspaces (id, name, kind, owner_id) VALUES (10, 'Группа', 'group', 1);
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (10, 1, 'owner'), (10, 2, 'editor');
  `);
  /** @type {{ uid: number, event: Record<string, unknown> }[]} */
  let told = [];
  const open = [1, 2, 3]; // the people with a tab open
  const hub = {
    tell: (/** @type {(uid: number) => Record<string, unknown> | null} */ pick) => {
      for (const uid of open) {
        const event = pick(uid);
        if (event) told.push({ uid, event });
      }
    },
  };
  const live = createLive(db, hub, createAuth(db));
  assert.equal(live.tick(), 0, 'what was before the start is not told');
  assert.deepEqual(told, []);

  db.exec("INSERT INTO annotations (workspace_id, author_id, ref) VALUES (10, 1, '5:1.1')");
  db.exec("INSERT INTO tasks (user_id, title) VALUES (3, 'Прочитать Текст 5')");
  live.tick();
  assert.deepEqual(told, [
    { uid: 1, event: { type: 'changed', notes: [10], tasks: false } },
    { uid: 2, event: { type: 'changed', notes: [10], tasks: false } },
    { uid: 3, event: { type: 'changed', notes: [], tasks: true } }, // not a member: the notes are not hers
  ]);
  told = [];
  assert.equal(live.tick(), 0);
  assert.deepEqual(told, [], 'nothing new');
});
