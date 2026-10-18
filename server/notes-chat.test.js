// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createTagStore } from './tags.js';
import { createTranslation } from './translation.js';
import { createNotifications } from './notifications.js';
import { registerAnnotationRoutes } from './api/annotations.js';

test("note comments: the note's conversation — members only, replies, mentions, the bell, gone with the note", async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один два', 'one two', 'один два', 'one two');
    INSERT INTO users (id, username, username_key, display_name, created_at) VALUES
      (1, 'anna', 'anna', 'Анна', datetime('now', '-1 day')), (2, 'boris', 'boris', NULL, datetime('now', '-1 day')),
      (3, 'outsider', 'outsider', NULL, datetime('now', '-1 day'));
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Группа', 'group');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'owner'), (2, 2, 'commenter');
  `);
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  const bell = createNotifications(db, createTranslation(db));
  const router = createRouter();
  registerAnnotationRoutes(router, db, createTagStore(db), auth, chat);
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: ['', 'anna', 'boris', 'outsider'][id], displayName: null, isAdmin: false, isCoordinator: false, isTranslator: false });
  /** @param {string} method @param {string} path @param {number} uid @param {unknown} [body] */
  const call = async (method, path, uid, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: user(uid) }));
  };

  // a note with its first comment
  const note = await call('POST', '/api/workspaces/2/annotations', 1, { ref: '5:1.1', lang: 'ru', start: 0, end: 4, comment: 'Важно, @boris и @outsider' });
  const key = `note:${note.id}`;
  assert.equal(note.comments.length, 1);
  assert.deepEqual(note.comments[0].reactions, []);
  // mentions only for members of the note's workspace
  const mentioned = db.prepare('SELECT user_id AS u FROM mentions WHERE message_id = ?').all(note.comments[0].id).map((r) => r.u);
  assert.deepEqual(mentioned, [2]);

  // a reply with a quote, a reaction — the common chat model
  const after = await call('POST', `/api/workspaces/2/annotations/${note.id}/comments`, 2, { body: 'Согласен', replyTo: note.comments[0].id });
  assert.equal(after.comments[1].reply.authorName, 'Анна');
  chat.react(after.comments[1].id, user(1), '👍');
  const again = await call('GET', '/api/workspaces/2/annotations', 1);
  assert.equal(again[0].comments[1].reactions[0].emoji, '👍');

  // outsiders see nothing of it
  assert.throws(() => chat.page(key, user(3)), /Заметка не найдена/);
  assert.throws(() => chat.post(key, user(3), { body: 'x' }), /Заметка не найдена/);
  assert.deepEqual(chat.users('', user(1), key).map((u) => u.id).sort(), [1, 2]);

  // the bell: the note's author hears the reply; the mentioned member hears the mention; outsiders nothing
  assert.equal(bell.counts(user(1)).unread, 1);
  assert.equal(bell.list(user(1))[0].noteRef, '5:1.1');
  assert.equal(bell.list(user(1))[0].chatTitle, 'Заметка · 5:1.1');
  // (the mentioned member answered in the note's conversation: the mention is there, read)
  assert.ok(bell.list(user(2)).some((n) => n.mention && !n.unread));
  assert.equal(bell.counts(user(2)).unread, 0);
  assert.equal(bell.counts(user(3)).unread, 0);

  // a member removed from the workspace stops hearing it
  db.exec('DELETE FROM workspace_members WHERE workspace_id = 2 AND user_id = 2');
  assert.equal(bell.list(user(2)).filter((n) => n.ref === key).length, 0);

  // deleting a comment keeps a note that still has others; the last one takes an empty note along
  const tmp = await call('POST', '/api/workspaces/2/annotations', 1, { ref: '5:1.1', comment: 'первый' });
  const two = await call('POST', `/api/workspaces/2/annotations/${tmp.id}/comments`, 1, { body: 'второй' });
  const left = await call('DELETE', `/api/workspaces/2/annotations/${tmp.id}/comments/${two.comments[1].id}`, 1);
  assert.equal(left.comments.length, 1);
  assert.deepEqual(await call('DELETE', `/api/workspaces/2/annotations/${tmp.id}/comments/${two.comments[0].id}`, 1), { id: tmp.id, deleted: true });

  // the owner deletes others' comments; the note goes — its conversation goes too
  assert.equal(chat.ownsChat(key, user(1)), true);
  await call('DELETE', `/api/workspaces/2/annotations/${note.id}`, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_messages WHERE ref = ?').get(key)?.n, 0);

  // and so does a deleted workspace (its notes cascade)
  const n2 = await call('POST', '/api/workspaces/2/annotations', 1, { ref: '5:1.1', comment: 'ещё' });
  db.exec('DELETE FROM workspaces WHERE id = 2');
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_messages WHERE ref = ?').get(`note:${n2.id}`)?.n, 0);
});
