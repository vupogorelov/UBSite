// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createBookVoice } from './bookvoice.js';
import { buildSearchIndex } from './search/engine.js';

const LONG = 'Слово '.repeat(60).trim(); // ~360 characters: reads as a quote

test("the Book's voice: once a day at 9 (Moscow), a paragraph never twice, its discussion in the general chat", () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', '${LONG}', 'one', '${LONG}', 'one'),
      ('5:1.2', 2, 5, 1, 2, '62.2', '${LONG}', 'two', '${LONG}', 'two'),
      ('5:1.3', 3, 5, 1, 3, '62.3', 'Коротко.', 'Short.', 'Коротко.', 'Short.');
    INSERT INTO users (id, username, username_key, created_at) VALUES (10, 'anna', 'anna', datetime('now', '-1 day'));
  `);
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  const voice = createBookVoice(db, auth, chat);
  const anna = /** @type {any} */ ({ id: 10, username: 'anna', displayName: null, isAdmin: false, isCoordinator: false });
  const channel = /** @type {{ id: number, discussion: string }} */ (db.prepare('SELECT id, discussion FROM channels WHERE voice = 1').get());
  const key = `chan:${channel.id}`;
  assert.equal(channel.discussion, 'chan:1');

  // the Book is a user that never signs in
  assert.equal(auth.login('urantiabook', ''), null);
  // people do not write in its channel
  assert.throws(() => chat.post(key, anna, { body: 'привет' }), /говорит Книга/);

  // before 9 in Moscow — nothing; at 9:00 Moscow (6:00 UTC) — a post; the same day — nothing more
  assert.equal(voice.tick(Date.parse('2026-10-12T05:59:00Z')), null);
  const first = voice.tick(Date.parse('2026-10-12T06:00:00Z'));
  assert.ok(first);
  assert.equal(voice.tick(Date.parse('2026-10-12T20:00:00Z')), null);
  assert.notEqual(first.ref, '5:1.3'); // too short for a quote

  // the post: by the Book, anchored, with its paragraph; its copy opens the discussion in the general chat
  const [post] = chat.page(key, anna);
  assert.equal(post.authorAgent, true);
  assert.equal(post.anchorRef, first.ref);
  assert.equal(post.post?.ref, first.ref);
  assert.equal(post.linkedId, first.discussionId);
  const copy = chat.page('chan:1', anna).find((m) => m.id === first.discussionId);
  assert.equal(copy?.anchorRef, first.ref);
  // a reply there counts as the post's comment
  chat.post('chan:1', anna, { body: 'Как это понимать?', replyTo: first.discussionId });
  assert.equal(chat.page(key, anna)[0].comments, 1);

  // the next day — the other paragraph; then nothing is left
  const second = voice.tick(Date.parse('2026-10-13T07:00:00Z'));
  assert.ok(second);
  assert.notEqual(second.ref, first.ref);
  assert.throws(() => voice.tick(Date.parse('2026-10-14T07:00:00Z')), /уже прозвучали/);

  // paused — silent
  voice.pause(true);
  assert.equal(voice.tick(Date.parse('2026-10-15T07:00:00Z')), null);
  assert.equal(voice.status().paused, true);

  // a muted chat's news is not counted (mentions still would be)
  assert.ok(chat.unreadTotal(anna).unread > 0);
  chat.mute(key, anna, true);
  chat.mute('chan:1', anna, true);
  assert.equal(chat.unreadTotal(anna).unread, 0);
  assert.equal(chat.list(anna).find((c) => c.key === key)?.muted, true);
});

test('"Я и Книга": one\'s own conversation; the Book answers with the paragraphs that speak of the question', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'Молитва есть дыхание души.', 'one', 'Молитва есть дыхание души.', 'one'),
      ('5:1.2', 2, 5, 1, 2, '62.2', 'Настройщик Мысли живёт в разуме человека.', 'two', 'Настройщик Мысли живёт в разуме человека.', 'two'),
      ('5:1.3', 3, 5, 1, 3, '62.3', 'О звёздах и планетах.', 'three', 'О звёздах и планетах.', 'three');
    INSERT INTO users (id, username, username_key, created_at) VALUES
      (10, 'anna', 'anna', datetime('now', '-1 day')), (11, 'boris', 'boris', datetime('now', '-1 day'));
  `);
  buildSearchIndex(db);
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  const voice = createBookVoice(db, auth, chat);
  const user = (/** @type {number} */ id) => /** @type {any} */ ({ id, username: `u${id}`, displayName: null, isAdmin: false, isCoordinator: false });
  const anna = user(10), boris = user(11);

  // always in one's list; nobody else's
  assert.equal(chat.list(anna).find((c) => c.key === 'dm:10')?.title, 'Я и Книга');
  assert.throws(() => chat.page('dm:10', boris), /не найден/);
  assert.throws(() => chat.post('dm:10', boris, { body: 'x' }), /не найден/);

  // a question → the paragraph about it, as a reply to the question, by the Book
  /** @type {string[]} */ const asked = [];
  chat.onDirect((key) => asked.push(key));
  const q = chat.post('dm:10', anna, { body: 'Кто такой Настройщик Мысли?' });
  assert.deepEqual(asked, ['dm:10']);
  assert.deepEqual(await voice.answer('dm:10', q), ['5:1.2']);
  const [, reply] = chat.page('dm:10', anna);
  assert.equal(reply.authorAgent, true);
  assert.equal(reply.post?.ref, '5:1.2');
  assert.equal(reply.replyTo, q.id);

  // nothing about it — it says so
  const q2 = chat.post('dm:10', anna, { body: 'Как испечь пирог?' });
  assert.deepEqual(await voice.answer('dm:10', q2), []);
  assert.match(chat.page('dm:10', anna).at(-1)?.body ?? '', /не нашлось/);

  // another way to find (the Laboratory's, for its owner): its refs; not this one's (null) or failing — the words
  voice.useFinder(async (_text, owner) => (owner === 10 ? ['5:1.1'] : null));
  assert.deepEqual(await voice.answer('dm:10', chat.post('dm:10', anna, { body: 'Кто такой Настройщик Мысли?' })), ['5:1.1']);
  voice.useFinder(async () => {
    throw new Error('no model');
  });
  assert.deepEqual(await voice.answer('dm:10', chat.post('dm:10', anna, { body: 'Кто такой Настройщик Мысли?' })), ['5:1.2']);

  // in its own words (the remote AI, for whom it is connected): the words alone, as the reply — the paragraphs'
  // numbers in them are the way to the text
  voice.useFinder(null);
  /** @type {any[]} */ const wrote = [];
  voice.useWriter(async (question, refs, owner) => (wrote.push({ question, refs, owner }), owner === 10 ? 'Он живёт в разуме человека (5:1.2).' : null));
  const q3 = chat.post('dm:10', anna, { body: 'Где живёт Настройщик Мысли?' });
  await voice.answer('dm:10', q3);
  const [asked3, words] = chat.page('dm:10', anna).slice(-2);
  assert.deepEqual(wrote[0], { question: 'Где живёт Настройщик Мысли?', refs: ['5:1.2'], owner: 10 });
  assert.equal(asked3.id, q3.id, 'nothing more than the words after the question');
  assert.deepEqual([words.body, words.replyTo, words.post?.ref], ['Он живёт в разуме человека (5:1.2).', q3.id, undefined]);
  // it fails: the paragraphs alone, as before
  voice.useWriter(async () => {
    throw new Error('no model');
  });
  const q4 = chat.post('dm:10', anna, { body: 'Где живёт Настройщик Мысли?' });
  await voice.answer('dm:10', q4);
  assert.deepEqual([chat.page('dm:10', anna).at(-1)?.post?.ref, chat.page('dm:10', anna).at(-1)?.replyTo], ['5:1.2', q4.id]);

  // a conversation: «Новая тема» begins it anew; a follow-up goes on with the talk so far and the last answer's paragraphs
  voice.newTopic('dm:10');
  assert.equal(chat.page('dm:10', anna).at(-1)?.body, 'Новая тема');
  /** @type {any[]} */ const calls = [];
  voice.useWriter(async (question, refs, owner, history) => (calls.push({ question, refs, history }), `Ответ ${calls.length} (${refs[0]}).`));
  await voice.answer('dm:10', chat.post('dm:10', anna, { body: 'Что такое молитва?' }));
  assert.deepEqual([calls[0].refs, calls[0].history], [['5:1.1'], []], 'a new topic: nothing before it');
  await voice.answer('dm:10', chat.post('dm:10', anna, { body: 'А подробнее?' }));
  assert.deepEqual(calls[1].history, [{ role: 'user', content: 'Что такое молитва?' }, { role: 'assistant', content: 'Ответ 1 (5:1.1).' }], 'the talk so far');
  assert.ok(calls[1].refs.includes('5:1.1'), "the last answer's paragraphs go on (the follow-up alone finds nothing)");
});

test('"Я и Книга" in English: an English question is answered from the English text', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'Молитва', 'Prayer is the breath of the soul.', 'Молитва', 'Prayer is the breath of the soul.'),
      ('5:1.2', 2, 5, 1, 2, '62.2', 'Звёзды', 'Stars and planets.', 'Звёзды', 'Stars and planets.');
    INSERT INTO users (id, username, username_key, created_at) VALUES (10, 'anna', 'anna', datetime('now', '-1 day'));
  `);
  buildSearchIndex(db);
  const auth = createAuth(db);
  const chat = createChat(db, auth);
  const voice = createBookVoice(db, auth, chat);
  const anna = /** @type {any} */ ({ id: 10, username: 'anna', displayName: null, isAdmin: false, isCoordinator: false });
  const q = chat.post('dm:10', anna, { body: 'What is prayer?' });
  assert.deepEqual(await voice.answer('dm:10', q), ['5:1.1']);
});
