// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { registerTaskRoutes } from './api/tasks.js';

function setup() {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one'), ('5:1.2', 2, 5, 1, 2, '62.2', 'два', 'two', 'два', 'two');
    INSERT INTO users (id, username, username_key) VALUES (1, 'me', 'me'), (2, 'other', 'other');
    INSERT INTO workspaces (id, name, kind) VALUES (2, 'Чужое', 'personal');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 2, 'owner');
    INSERT INTO annotations (id, workspace_id, author_id, ref, color) VALUES (9, 2, 2, '5:1.2', 'green');
  `);
  const router = createRouter();
  registerTaskRoutes(router, db, createAuth(db));
  /** @param {string} method @param {string} path @param {1 | 2} uid @param {unknown} [body] */
  const call = async (method, path, uid, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: /** @type {any} */ ({ id: uid }) }));
  };
  return { call };
}

test('tasks: lists, links to the book, status, subtasks, privacy and the due counter', async () => {
  const { call } = setup();
  const { id: list } = await call('POST', '/api/task-lists', 1, { title: 'Доклад', emoji: '📚' });
  const t = await call('POST', '/api/tasks', 1, { title: 'Перечитать', listId: list, ref: '5:1.1', refEnd: '5:1.2', due: '2026-10-06', tags: ['#чтение', 'план'] });
  assert.equal(t.refEnd, '5:1.2');
  assert.deepEqual(t.tags, ['чтение', 'план']);
  assert.equal(t.paperTitle, 'Текст');
  await assert.rejects(call('POST', '/api/tasks', 1, { title: 'x', ref: '9:9.9' }), /не найден/);
  await assert.rejects(call('POST', '/api/tasks', 1, { title: 'x', annotationId: 9 }), /Заметка не найдена/); // not my workspace
  await assert.rejects(call('POST', '/api/tasks', 1, { title: 'x', due: 'завтра' }), /ГГГГ/);

  const withSub = await call('POST', `/api/tasks/${t.id}/subtasks`, 1, { title: 'Выписать цитаты' });
  const sid = withSub.subtasks[0].id;
  assert.equal((await call('PATCH', `/api/tasks/${t.id}/subtasks/${sid}`, 1, { done: true })).subtasks[0].done, true);

  assert.equal((await call('GET', '/api/tasks/count?today=2026-10-06', 1)).due, 1);
  const done = await call('PATCH', `/api/tasks/${t.id}`, 1, { status: 'done' });
  assert.ok(done.doneAt);
  assert.equal((await call('GET', '/api/tasks/count?today=2026-10-06', 1)).due, 0);
  assert.equal((await call('PATCH', `/api/tasks/${t.id}`, 1, { status: 'todo' })).doneAt, null);

  // another user sees nothing and cannot touch it
  assert.deepEqual((await call('GET', '/api/tasks', 2)).tasks, []);
  await assert.rejects(call('PATCH', `/api/tasks/${t.id}`, 2, { title: 'взлом' }), /не найдена/);
  // deleting the list keeps its tasks
  await call('DELETE', `/api/task-lists/${list}`, 1);
  const all = await call('GET', '/api/tasks', 1);
  assert.equal(all.tasks.length, 1);
  assert.equal(all.tasks[0].listId, null);
});
