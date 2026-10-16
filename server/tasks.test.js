// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { registerTaskRoutes } from './api/tasks.js';
import { createChat } from './chat.js';
import { taskTags, titleTags, stripTag, titleParts, normTag } from '../shared/tasktags.js';

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
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  registerTaskRoutes(router, db, auth, chat);
  /** @param {string} method @param {string} path @param {1 | 2} uid @param {unknown} [body] */
  const call = async (method, path, uid, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: /** @type {any} */ ({ id: uid }) }));
  };
  return { call, chat };
}

test('tasks: tags, links to the book, status, subtasks, privacy and the due counter', async () => {
  const { call } = setup();
  const t = await call('POST', '/api/tasks', 1, { title: 'Перечитать #Доклад', ref: '5:1.1', refEnd: '5:1.2', due: '2026-10-06', tags: ['#Чтение', 'план', 'план', 'не метка'] });
  assert.equal(t.refEnd, '5:1.2');
  // the details' tags: lower case, without repeats and what is not a tag; with the title's — all of them
  assert.deepEqual(t.tags, ['чтение', 'план']);
  assert.deepEqual(taskTags(t), ['доклад', 'чтение', 'план']);
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
  // no lists any more
  const all = await call('GET', '/api/tasks', 1);
  assert.equal(all.tasks.length, 1);
  assert.equal('listId' in all.tasks[0], false);
  assert.equal(all.lists, undefined);
});

test('task tags in the title: found, drawn in place, taken out', () => {
  assert.deepEqual(titleTags('Списки доделать #фикс, и #Фикс ещё #ui/ux! a#b C# #'), ['фикс', 'ui/ux']);
  assert.equal(stripTag('Доделать #Фикс списки #ui', 'фикс'), 'Доделать списки #ui');
  assert.equal(stripTag('#фикс Доделать', 'фикс'), 'Доделать');
  assert.deepEqual(titleParts('Доделать #Фикс, сразу'), [
    { tag: null, text: 'Доделать ' }, { tag: 'фикс', text: '#Фикс' }, { tag: null, text: ', сразу' },
  ]);
  assert.equal(normTag(' #Фикс '), 'фикс');
  assert.equal(normTag('две метки'), null);
});

test('tasks: from a message — the way back to it and its place; only what one may read', async () => {
  const { call, chat } = setup();
  const me = /** @type {any} */ ({ id: 1, username: 'me', displayName: null });
  const other = /** @type {any} */ ({ id: 2, username: 'other', displayName: null });
  const inChannel = chat.post('chan:1', me, { body: 'Ошибка в 5:1.2 — проверить' });
  const t = await call('POST', '/api/tasks', 1, { title: 'Проверить ошибку', messageId: inChannel.id });
  assert.equal(t.messageChat, 'chan:1');
  assert.equal(t.messageChatTitle, 'Общий');
  assert.equal(t.ref, '5:1.2'); // the paragraph the message refers to
  const inThread = chat.post('5:1.1', me, { body: 'Обсудить' });
  assert.equal((await call('POST', '/api/tasks', 1, { title: 'x', messageId: inThread.id })).ref, '5:1.1');
  // an edit keeps the way back
  assert.equal((await call('PATCH', `/api/tasks/${t.id}`, 1, { title: 'Исправлено' })).messageId, inChannel.id);
  // a note's comment in someone else's workspace cannot be taken
  const onNote = chat.post('note:9', other, { body: 'личное' });
  await assert.rejects(call('POST', '/api/tasks', 1, { title: 'y', messageId: onNote.id }), /Заметка не найдена/);
});

test("tasks offline: the device's own id, u-<uid> addresses, a subtask ticked before it was sent, the order by addresses, the feed", async () => {
  const { call } = setup();
  const uid = '1c2d3e4f-0000-4000-8000-00000000abcd';
  const first = await call('GET', '/api/tasks/changes', 1);
  assert.equal(first.reset, true);
  const t = await call('POST', '/api/tasks', 1, { uid, title: 'Без сети' });
  assert.equal((await call('POST', '/api/tasks', 1, { uid, title: 'Без сети' })).id, t.id, 'the same uid is the same task');
  const withSub = await call('POST', `/api/tasks/u-${uid}/subtasks`, 1, { title: 'Шаг', done: true });
  assert.equal(withSub.subtasks[0].done, true);
  await call('PATCH', `/api/tasks/u-${uid}`, 1, { status: 'doing' });
  const other = await call('POST', '/api/tasks', 1, { title: 'Другая' });
  await call('PUT', '/api/tasks/order', 1, { ids: [other.id, `u-${uid}`] });

  // the feed: what changed after the first look — both tasks, once each; another person's not
  await call('POST', '/api/tasks', 2, { title: 'Чужая' });
  const f = await call('GET', `/api/tasks/changes?since=${first.seq}`, 1);
  assert.equal(f.reset, false);
  assert.deepEqual(f.tasks.map((/** @type {any} */ x) => x.title).sort(), ['Без сети', 'Другая']);
  const mine = f.tasks.find((/** @type {any} */ x) => x.id === t.id);
  assert.equal(mine.status, 'doing');
  assert.equal(mine.pos, 1);
  await call('DELETE', `/api/tasks/u-${uid}`, 1);
  const g = await call('GET', `/api/tasks/changes?since=${f.seq}`, 1);
  assert.deepEqual(g.deleted, [t.id]);
  await assert.rejects(call('PATCH', `/api/tasks/u-${uid}`, 1, { status: 'done' }), /Задача не найдена/);
});
