// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createTranslation } from './translation.js';
import { createNotifications } from './notifications.js';

test("marks take / work / done: the administrator's, seen on the message, told to its author, found by the filter", () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO users (id, username, username_key, created_at) VALUES
      (1, 'admin', 'admin', datetime('now', '-1 day')), (2, 'anna', 'anna', datetime('now', '-1 day')), (3, 'boris', 'boris', datetime('now', '-1 day'));
    INSERT INTO workspaces (id, name, kind) VALUES (4, 'Группа', 'group');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (4, 1, 'owner'), (4, 2, 'editor');
  `);
  const chat = createChat(db, createAuth(db));
  const bell = createNotifications(db, createTranslation(db));
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: ['', 'admin', 'anna', 'boris'][id], displayName: null, isAdmin: id === 1, isCoordinator: false, isTranslator: false });
  const admin = user(1), anna = user(2), boris = user(3);

  const bug = chat.post('chan:1', anna, { body: 'Не открывается подборка' });
  const idea = chat.post('ws:4', anna, { body: 'Добавить тёмную тему' });

  // only the administrator marks
  assert.throws(() => chat.mark(bug.id, anna, 'take'), /администратор/);
  assert.throws(() => chat.mark(bug.id, admin, 'later'), /take, work или done/);
  assert.equal(chat.mark(bug.id, admin, 'take').mark, 'take');
  chat.mark(bug.id, admin, 'work');
  chat.mark(idea.id, admin, 'done');
  // everyone sees it on the message
  assert.equal(chat.page('chan:1', boris).find((m) => m.id === bug.id)?.mark, 'work');

  // the author is told, with the message; the chat itself gets no service lines
  const news = bell.list(anna).filter((n) => n.ref.startsWith('mark:'));
  assert.deepEqual(news.map((n) => [n.body, n.markedId]), [['done', idea.id], ['work', bug.id], ['take', bug.id]]);
  assert.equal(chat.page('chan:1', anna).length, 1);

  // the filter: by mark, only from chats one may read
  assert.deepEqual(chat.marked(admin, null).map((m) => [m.id, m.mark, m.chatTitle]), [[idea.id, 'done', 'Группа'], [bug.id, 'work', 'Общий']]);
  assert.deepEqual(chat.marked(admin, 'work').map((m) => m.id), [bug.id]);
  assert.deepEqual(chat.marked(boris, null).map((m) => m.id), [bug.id]); // not a member of the group

  // taken off: gone from the filter, nobody is told
  chat.mark(bug.id, admin, null);
  assert.deepEqual(chat.marked(admin, null).map((m) => m.id), [idea.id]);
  assert.equal(bell.list(anna).filter((n) => n.ref.startsWith('mark:')).length, 3);
});
