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

test("a note's own id from its device: the same uid is the same note; u-<uid> addresses it before its number is known", async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один два три', 'one two three', 'один два три', 'one two three');
    INSERT INTO users (id, username, username_key) VALUES (1, 'anna', 'anna');
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Личное', 'personal'), (3, 'Другое', 'personal');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'owner'), (3, 1, 'owner');
  `);
  const auth = createAuth(db);
  const router = createRouter();
  registerAnnotationRoutes(router, db, createTagStore(db), auth, createChat(db, auth));
  const me = /** @type {any} */ ({ id: 1, username: 'anna', displayName: null, isAdmin: false, isCoordinator: false, isTranslator: false });
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: me }));
  };
  const uid = '0f3c2b9e-7d1a-4c55-9a0e-1b2c3d4e5f60';

  const note = await call('POST', '/api/workspaces/2/annotations', { uid, ref: '5:1.1', lang: 'ru', start: 0, end: 4, bookmark: true });
  assert.equal(note.uid, uid);
  // the same uid again: the same note, not a second one
  const again = await call('POST', '/api/workspaces/2/annotations', { uid, ref: '5:1.1', lang: 'ru', start: 0, end: 4, bookmark: true });
  assert.equal(again.id, note.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM annotations').get()?.n, 1);
  // another workspace may have a note with the same uid (ids are per workspace)
  const other = await call('POST', '/api/workspaces/3/annotations', { uid, ref: '5:1.1', bookmark: true });
  assert.notEqual(other.id, note.id);

  // addressed by u-<uid>: a comment, the tags, a change, the deletion
  const commented = await call('POST', `/api/workspaces/2/annotations/u-${uid}/comments`, { body: 'Мысль' });
  assert.equal(commented.id, note.id);
  assert.equal(commented.comments.length, 1);
  assert.deepEqual((await call('PUT', `/api/workspaces/2/annotations/u-${uid}/tags`, { tags: ['вопрос'] })).tags, ['вопрос']);
  assert.equal((await call('PATCH', `/api/workspaces/2/annotations/u-${uid}`, { color: 'green' })).color, 'green');
  assert.deepEqual(await call('DELETE', `/api/workspaces/2/annotations/u-${uid}`), { id: note.id, deleted: true });
  await assert.rejects(call('PATCH', `/api/workspaces/2/annotations/u-${uid}`, { color: 'blue' }), /Заметка не найдена/);
  await assert.rejects(call('POST', '/api/workspaces/2/annotations', { uid: 'bad id!', ref: '5:1.1', bookmark: true }), /uid/);
});
