// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createTagStore } from './tags.js';
import { registerAnnotationRoutes } from './api/annotations.js';

test('the feed of changes: every change of a note is in "after N", once; other workspaces are not; far behind — everything anew', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один два', 'one two', 'один два', 'one two'),
             ('5:1.2', 2, 5, 1, 2, '62.2', 'три', 'three', 'три', 'three');
    INSERT INTO users (id, username, username_key) VALUES (1, 'anna', 'anna');
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Личное', 'personal'), (3, 'Другое', 'personal');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'owner'), (3, 1, 'owner');
  `);
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  const tags = createTagStore(db);
  const router = createRouter();
  registerAnnotationRoutes(router, db, tags, auth, chat);
  const me = /** @type {any} */ ({ id: 1, username: 'anna', displayName: null, isAdmin: false, isCoordinator: false, isTranslator: false });
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: me }));
  };
  const feed = (/** @type {number} */ since) => call('GET', `/api/workspaces/2/changes?since=${since}`);

  // the first time (no `since`): everything
  const first = await call('GET', '/api/workspaces/2/changes');
  assert.equal(first.reset, true);
  assert.deepEqual(first.notes, []);

  const a = await call('POST', '/api/workspaces/2/annotations', { ref: '5:1.1', lang: 'ru', start: 0, end: 4, bookmark: true });
  await call('POST', '/api/workspaces/3/annotations', { ref: '5:1.1', bookmark: true }); // (another workspace)
  let f = await feed(first.seq);
  assert.equal(f.reset, false);
  assert.deepEqual(f.notes.map((/** @type {any} */ n) => n.id), [a.id]);
  let since = f.seq;
  assert.deepEqual((await feed(since)).notes, []); // nothing new

  // tags, a tag's rename, a comment, a reaction on it — each a change of the note
  await call('PUT', `/api/workspaces/2/annotations/${a.id}/tags`, { tags: ['вопрос'] });
  f = await feed(since);
  assert.deepEqual(f.notes[0].tags, ['вопрос']);
  since = f.seq;
  tags.rename(2, 'вопрос', 'ответ');
  f = await feed(since);
  assert.deepEqual(f.notes[0].tags, ['ответ']);
  since = f.seq;
  const c = await call('POST', `/api/workspaces/2/annotations/${a.id}/comments`, { body: 'Мысль' });
  f = await feed(since);
  assert.equal(f.notes.length, 1, 'a change of the note, once');
  assert.equal(f.notes[0].comments[0].body, 'Мысль');
  since = f.seq;
  chat.react(c.comments[0].id, me, '👍');
  f = await feed(since);
  assert.equal(f.notes[0].comments[0].reactions[0].emoji, '👍');
  since = f.seq;

  // deleted: its id
  await call('DELETE', `/api/workspaces/2/annotations/${a.id}`);
  f = await feed(since);
  assert.deepEqual(f.notes, []);
  assert.deepEqual(f.deleted, [a.id]);

  // far behind (the feed no longer reaches): everything anew
  const b = await call('POST', '/api/workspaces/2/annotations', { ref: '5:1.2', bookmark: true });
  db.exec('DELETE FROM changes WHERE seq <= ' + (f.seq + 0));
  const far = await feed(1);
  assert.equal(far.reset, true);
  assert.deepEqual(far.notes.map((/** @type {any} */ n) => n.id), [b.id]);
});
