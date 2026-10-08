// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createTranslation } from './translation.js';
import { createNotifications } from './notifications.js';

test('chat: channels, workspace chats, replies, reactions, mentions and unread counts', () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one');
    INSERT INTO users (id, username, username_key, display_name, created_at) VALUES
      (1, 'anna', 'anna', 'Анна', datetime('now', '-1 day')), (2, 'boris', 'boris', NULL, datetime('now', '-1 day')),
      (3, 'outsider', 'outsider', NULL, datetime('now', '-1 day'));
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Группа', 'group');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'owner'), (2, 2, 'commenter');
  `);
  const chat = createChat(db, createAuth(db));
  const notes = createNotifications(db, createTranslation(db));
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: ['', 'anna', 'boris', 'outsider'][id], displayName: null, isAdmin: false, isCoordinator: false, isTranslator: false });

  // the default channel "Общий" (chan:1) is open to everyone
  const hello = chat.post('chan:1', user(1), { body: 'Всем привет! @boris, посмотри 5:1.1' });
  const reply = chat.post('chan:1', user(2), { body: 'Смотрю', replyTo: hello.id });
  assert.equal(reply.reply.authorName, 'Анна');
  assert.throws(() => chat.post('chan:1', user(2), { body: 'x', replyTo: 999 }), /другого чата/);

  // unread: boris has the mention, anna has boris's reply
  const bList = chat.list(user(2));
  assert.equal(bList.find((c) => c.key === 'chan:1').unread, 0); // he wrote after it: posting marks read
  const aList = chat.list(user(1));
  assert.equal(aList.find((c) => c.key === 'chan:1').unread, 1);
  chat.markRead('chan:1', user(1), reply.id);
  assert.equal(chat.unreadTotal(user(1)).unread, 0);
  // the mention reaches boris's bell
  assert.ok(notes.list(user(2)).some((n) => n.id === hello.id && n.mention));

  // reactions toggle
  assert.deepEqual(chat.react(hello.id, user(2), '👍').map((r) => [r.emoji, r.n, r.mine]), [['👍', 1, true]]);
  assert.deepEqual(chat.react(hello.id, user(2), '👍'), []);
  assert.throws(() => chat.react(hello.id, user(2), '💩'), /Неизвестная реакция/);

  // a workspace chat: members only; viewers and outsiders cannot write
  chat.post('ws:2', user(2), { body: 'В группе' });
  assert.throws(() => chat.page('ws:2', user(3)), /не найден/);
  assert.equal(chat.page('ws:2', user(1)).length, 1);
  assert.ok(chat.list(user(1)).some((c) => c.key === 'ws:2'));
  assert.ok(!chat.list(user(3)).some((c) => c.key === 'ws:2'));

  // a paragraph thread joins the list once the user takes part
  assert.ok(!chat.list(user(3)).some((c) => c.key === '5:1.1'));
  chat.post('5:1.1', user(3), { body: 'Вопрос по абзацу' });
  assert.ok(chat.list(user(3)).some((c) => c.key === '5:1.1' && c.title === 'Абзац 5:1.1'));
  assert.throws(() => chat.post('9:9.9', user(3), { body: 'x' }), /не найден/);
});
