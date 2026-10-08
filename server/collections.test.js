// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { registerCollectionRoutes } from './api/collections.js';

function setup() {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one'),
      ('5:1.2', 2, 5, 1, 2, '62.2', 'два', 'two', 'два', 'two'),
      ('5:1.3', 3, 5, 1, 3, '62.3', 'три', 'three', 'три', 'three');
    INSERT INTO users (id, username, username_key) VALUES (1, 'owner', 'owner'), (2, 'other', 'other');
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Группа', 'group'), (3, 'Другое', 'personal');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'owner'), (3, 2, 'owner');
    INSERT INTO annotations (id, workspace_id, author_id, ref, lang, start_pos, end_pos, quote, color) VALUES (7, 2, 1, '5:1.2', 'ru', 0, 3, 'два', 'yellow');
    INSERT INTO annotations (id, workspace_id, author_id, ref, color) VALUES (8, 2, 1, '5:1.3', 'green');
    INSERT INTO comments (annotation_id, author_id, body) VALUES (7, 1, 'важно');
  `);
  const router = createRouter();
  registerCollectionRoutes(router, db, createAuth(db));
  const users = { 1: { id: 1, username: 'owner' }, 2: { id: 2, username: 'other' } };
  /** @param {string} method @param {string} path @param {1 | 2} uid @param {unknown} [body] */
  const call = async (method, path, uid, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: /** @type {any} */ (users[uid]) }));
  };
  return { db, call };
}

test('collections: items in order, sharing, subscription and copy', async () => {
  const { call } = setup();
  const c = await call('POST', '/api/workspaces/2/collections', 1, { title: 'Доклад' });
  const a = await call('POST', `/api/collections/${c.id}/items`, 1, { kind: 'text', body: 'Введение', heading: true });
  const b = await call('POST', `/api/collections/${c.id}/items`, 1, { kind: 'para', ref: '5:1.1', refEnd: '5:1.2', body: 'начало' });
  const n = await call('POST', `/api/collections/${c.id}/items`, 1, { kind: 'note', annotationId: 7 });
  await assert.rejects(call('POST', `/api/collections/${c.id}/items`, 1, { kind: 'para', ref: '5:1.3', refEnd: '5:1.1' }), /раньше начала/);
  await assert.rejects(call('POST', `/api/collections/${c.id}/items`, 1, { kind: 'note', annotationId: 999 }), /не найдена/);
  // insert after the heading, then reorder
  const mid = await call('POST', `/api/collections/${c.id}/items`, 1, { kind: 'para', ref: '5:1.3', after: a.id });
  let full = await call('GET', `/api/collections/${c.id}`, 1);
  assert.deepEqual(full.list.map((/** @type {any} */ x) => x.id), [a.id, mid.id, b.id, n.id]);
  assert.deepEqual(full.list[2].paragraphs.map((/** @type {any} */ p) => p.ref), ['5:1.1', '5:1.2']);
  assert.equal(full.list[3].note.comments[0].body, 'важно');
  await call('PUT', `/api/collections/${c.id}/order`, 1, { ids: [a.id, b.id, n.id, mid.id] });
  full = await call('GET', `/api/collections/${c.id}`, 1);
  assert.deepEqual(full.list.map((/** @type {any} */ x) => x.id), [a.id, b.id, n.id, mid.id]);

  // a private collection is invisible to others; shared — readable, subscribable, copyable, not editable
  await assert.rejects(call('GET', `/api/collections/${c.id}`, 2), /не найдена/);
  await call('PATCH', `/api/collections/${c.id}`, 1, { shared: true });
  const seen = await call('GET', `/api/collections/${c.id}`, 2);
  assert.equal(seen.canEdit, false);
  assert.equal(seen.list[2].note.quote, 'два'); // the note in it is readable…
  await assert.rejects(call('POST', `/api/collections/${c.id}/items`, 2, { kind: 'text', body: 'x' }), /редакторы/);
  assert.deepEqual(await call('POST', `/api/collections/${c.id}/subscribe`, 2, { subscribed: true }), { subscribed: true });
  const mine = await call('GET', '/api/workspaces/3/collections', 2);
  assert.equal(mine.subscribed[0].id, c.id);
  const copy = await call('POST', `/api/collections/${c.id}/copy`, 2, { workspaceId: 3 });
  const copied = await call('GET', `/api/collections/${copy.id}`, 2);
  assert.equal(copied.canEdit, true);
  assert.deepEqual(copied.list.map((/** @type {any} */ x) => x.kind), ['text', 'para', 'para', 'para']); // the note became a paragraph…
  assert.match(copied.list[2].body, /«два»[\s\S]*важно/); // …keeping its quote and comments
});
