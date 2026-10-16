// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';

test('a pinned message: one per chat, pinned by whoever made the chat or an administrator', () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one');
    INSERT INTO users (id, username, username_key, created_at) VALUES
      (1, 'anna', 'anna', datetime('now', '-1 day')), (2, 'boris', 'boris', datetime('now', '-1 day')), (3, 'admin', 'admin', datetime('now', '-1 day'));
    INSERT INTO channels (id, title, created_by) VALUES (7, 'Канал Анны', 1);
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Группа', 'group');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'editor'), (2, 2, 'owner');
    INSERT INTO annotations (id, workspace_id, author_id, ref) VALUES (9, 2, 1, '5:1.1');
  `);
  const chat = createChat(db, createAuth(db));
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: `u${id}`, displayName: null, isAdmin: id === 3, isCoordinator: false });
  const anna = user(1), boris = user(2), admin = user(3);

  // a channel: its creator pins; others may not
  const a = chat.post('chan:7', boris, { body: 'Первое' });
  const b = chat.post('chan:7', boris, { body: 'Второе' });
  assert.equal(chat.info('chan:7', anna).canPin, true);
  assert.equal(chat.info('chan:7', boris).canPin, false);
  assert.throws(() => chat.pin('chan:7', boris, a.id), /создатель чата или администратор/);
  assert.equal(chat.pin('chan:7', anna, a.id).pinned.body, 'Первое');
  // one per chat: a new pin replaces the old one
  chat.pin('chan:7', anna, b.id);
  assert.equal(chat.info('chan:7', boris).pinned.id, b.id);
  // only a message of this chat
  const elsewhere = chat.post('chan:1', anna, { body: 'В общем' });
  assert.throws(() => chat.pin('chan:7', anna, elsewhere.id), /не из этого чата/);
  // the default channel has no creator: the administrator only
  assert.equal(chat.info('chan:1', anna).canPin, false);
  chat.pin('chan:1', admin, elsewhere.id);
  // unpin
  assert.equal(chat.pin('chan:7', admin, null).pinned, null);
  assert.equal(chat.info('chan:7', anna).pinned, null);

  // a workspace: its owner; a paragraph thread: the administrator only
  const w = chat.post('ws:2', anna, { body: 'Пространство' });
  assert.throws(() => chat.pin('ws:2', anna, w.id), /создатель/);
  chat.pin('ws:2', boris, w.id);
  const p = chat.post('5:1.1', anna, { body: 'Абзац' });
  assert.equal(chat.info('5:1.1', anna).canPin, false);
  chat.pin('5:1.1', admin, p.id);

  // a note: its author (and the workspace's owner)
  const n = chat.post('note:9', boris, { body: 'Комментарий' });
  assert.equal(chat.info('note:9', anna).canPin, true);
  chat.pin('note:9', anna, n.id);

  // a deleted message takes its pin along
  db.prepare('DELETE FROM public_messages WHERE id = ?').run(w.id);
  assert.equal(chat.info('ws:2', boris).pinned, null);
});

test("pinned chats: each user's own, up to 10, in their order, first in the list", () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one');
    INSERT INTO users (id, username, username_key, created_at) VALUES (1, 'anna', 'anna', datetime('now', '-1 day')), (2, 'boris', 'boris', datetime('now', '-1 day'));
    INSERT INTO channels (id, title) VALUES (12, 'Второй'), (13, 'Третий');
    INSERT INTO workspaces (id, name, kind) VALUES (4, 'Чужая группа', 'group');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (4, 2, 'owner');
  `);
  const chat = createChat(db, createAuth(db));
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: `u${id}`, displayName: null, isAdmin: false, isCoordinator: false });
  const anna = user(1), boris = user(2);
  chat.post('chan:1', anna, { body: 'новое' }); // the newest goes first among the unpinned
  const keys = (/** @type {any} */ u) => chat.list(u).map((c) => `${c.key}${c.pinned === null ? '' : `#${c.pinned}`}`);
  assert.deepEqual(keys(anna).slice(0, 1), ['chan:1']);

  // pin two in her order; a paragraph thread she does not follow stays in the list while pinned
  chat.setPinned(anna, ['chan:13', '5:1.1', 'chan:12']);
  assert.deepEqual(keys(anna), ['chan:13#0', '5:1.1#1', 'chan:12#2', 'chan:1', 'dm:1', 'chan:2']); // dm:1 — «Я и Книга», chan:2 — the Book's voice
  // reorder
  chat.setPinned(anna, ['chan:12', 'chan:13', '5:1.1']);
  assert.deepEqual(keys(anna).slice(0, 3), ['chan:12#0', 'chan:13#1', '5:1.1#2']);
  // others' lists are their own
  assert.deepEqual(keys(boris)[0], 'chan:1');
  // limits: 10, only chats she can see
  assert.throws(() => chat.setPinned(anna, Array.from({ length: 11 }, (_, i) => `chan:${i}`)), /до 10/);
  assert.throws(() => chat.setPinned(anna, ['ws:4']), /не найден/);
  // unpin all
  chat.setPinned(anna, []);
  assert.deepEqual(keys(anna), ['chan:1', 'dm:1', 'chan:2', 'chan:12', 'chan:13']);
});
