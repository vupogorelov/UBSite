// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { registerTaskRoutes } from './api/tasks.js';
import { createMarkTasks, titleOf } from './marktasks.js';

test("marks are the marker's tasks: made, moved, untagged; the task's status moves the mark back", async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one');
    INSERT INTO users (id, username, username_key, created_at) VALUES
      (1, 'admin', 'admin', datetime('now', '-1 day')), (2, 'anna', 'anna', datetime('now', '-1 day'));
  `);
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  chat.setMarkHook(createMarkTasks(db).sync);
  const router = createRouter();
  registerTaskRoutes(router, db, auth, chat);
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: ['', 'admin', 'anna'][id], displayName: null, isAdmin: id === 1, isCoordinator: false, isTranslator: false });
  const admin = user(1), anna = user(2);
  /** @param {string} method @param {string} path @param {any} who @param {unknown} [body] */
  const call = async (method, path, who, body) => {
    const url = new URL(path, 'http://x');
    const route = /** @type {any} */ (router.match(method, url.pathname));
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req, res: {}, params: route.params, url, user: who }));
  };
  const mine = async () => { const r = /** @type {any} */ (await call('GET', '/api/tasks', admin)); return /** @type {any[]} */ (r.tasks ?? r); };

  const bug = chat.post('chan:1', anna, { body: '> цитата из книги\nНе открывается подборка на телефоне, см. 5:1.1' });

  // take: a task with the tag, to do, the way back to the message, its place in the book
  chat.mark(bug.id, admin, 'take');
  let [t] = await mine();
  assert.equal(t.title, 'Не открывается подборка на телефоне, см. 5:1.1');
  assert.deepEqual([t.status, t.tags, t.messageId, t.messageChat, t.ref], ['todo', ['take'], bug.id, 'chan:1', '5:1.1']);

  // work, done: the same task, the tag and the status follow
  chat.mark(bug.id, admin, 'work');
  [t] = await mine();
  assert.equal((await mine()).length, 1);
  assert.deepEqual([t.status, t.tags], ['doing', ['work']]);
  chat.mark(bug.id, admin, 'done');
  [t] = await mine();
  assert.deepEqual([t.status, t.tags], ['done', ['done']]);
  assert.ok(t.doneAt);

  // the task moved back on the board: the message's mark moves too
  await call('PATCH', `/api/tasks/${t.id}`, admin, { status: 'doing' });
  assert.equal(chat.page('chan:1', admin).find((m) => m.id === bug.id)?.mark, 'work');
  [t] = await mine();
  assert.deepEqual([t.status, t.tags], ['doing', ['work']]);

  // the mark taken off: the tag goes, the task (with the person's own tags) stays
  await call('PATCH', `/api/tasks/${t.id}`, admin, { tags: ['work', 'ui'] });
  chat.mark(bug.id, admin, null);
  [t] = await mine();
  assert.deepEqual([t.status, t.tags], ['doing', ['ui']]);
  // …and moving it now leaves the message unmarked (no unasked news for its author)
  await call('PATCH', `/api/tasks/${t.id}`, admin, { status: 'done' });
  assert.equal(chat.page('chan:1', admin).find((m) => m.id === bug.id)?.mark, null);

  // a task already made from a message by hand is taken, not repeated
  const idea = chat.post('chan:1', anna, { body: 'Тёмная тема' });
  await call('POST', '/api/tasks', admin, { title: 'Сделать тёмную тему', messageId: idea.id });
  chat.mark(idea.id, admin, 'take');
  const ideas = (await mine()).filter((x) => x.messageId === idea.id);
  assert.deepEqual(ideas.map((x) => [x.title, x.tags]), [['Сделать тёмную тему', ['take']]]);
  // nobody else gets tasks from it
  assert.equal((/** @type {any[]} */ ((await call('GET', '/api/tasks', anna)).tasks ?? (await call('GET', '/api/tasks', anna)))).length, 0);
});

test('a task title from a message: its own words, on one line, not too long', () => {
  assert.equal(titleOf('> quoted\nМои слова\nи ещё'), 'Мои слова и ещё');
  assert.equal(titleOf('> только цитата'), 'только цитата');
  assert.equal(titleOf('а'.repeat(100)), `${'а'.repeat(80)}…`);
});

test('once: messages marked before marks became tasks get their tasks', () => {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO users (id, username, username_key, created_at) VALUES (1, 'admin', 'admin', datetime('now', '-1 day')), (2, 'anna', 'anna', datetime('now', '-1 day'));`);
  const auth = createAuth(db);
  const chat = createChat(db, auth); // no hook yet: the old way
  const admin = /** @type {any} */ ({ id: 1, username: 'admin', isAdmin: true });
  const anna = /** @type {any} */ ({ id: 2, username: 'anna', isAdmin: false });
  const a = chat.post('chan:1', anna, { body: 'Ошибка в поиске' });
  const b = chat.post('chan:1', anna, { body: 'Идея' });
  chat.mark(a.id, admin, 'work');
  chat.mark(b.id, admin, 'done');
  const marks = createMarkTasks(db);
  assert.equal(marks.backfill(), 2);
  const rows = /** @type {any[]} */ (db.prepare('SELECT user_id AS u, message_id AS m, status, tags FROM tasks ORDER BY message_id').all());
  assert.deepEqual(rows.map((r) => [r.u, r.m, r.status, JSON.parse(r.tags)]), [[1, a.id, 'doing', ['work']], [1, b.id, 'done', ['done']]]);
  assert.equal(marks.backfill(), 0); // only once
  assert.equal(/** @type {any} */ (db.prepare('SELECT count(*) AS n FROM tasks').get()).n, 2);
});
