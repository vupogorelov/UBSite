// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAi } from './ai.js';
import { createBookWords, BOOK_MODELS } from './bookwords.js';

test("«Я и Книга» in the Book's words: the reader's own AI first, then the shared answers of the day, then none", async (t) => {
  process.env.UB_AI_SHARED_PER_DAY = '2';
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '1', '', '', 'Молитва есть дыхание души.', 'Prayer is the breath of the soul.');
  `);
  const ai = createAi(db);
  const words = createBookWords(db, ai);
  /** @type {{ key: string, model: string, text: string }[]} */
  const asked = [];
  /** @type {(key: string, model: string) => { status: number, json: any }} */
  let answer = () => ({ status: 200, json: { choices: [{ message: { content: 'Молитва — дыхание души (5:1.1).' } }] } });
  t.mock.method(globalThis, 'fetch', async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const body = JSON.parse(init.body);
    const key = init.headers.Authorization.slice(7);
    asked.push({ key, model: body.model, text: body.messages[1].content });
    const a = answer(key, body.model);
    return new Response(JSON.stringify(a.json), { status: a.status });
  });
  const connect = (/** @type {string} */ owner, /** @type {string} */ key) => db.prepare("INSERT OR REPLACE INTO ai_keys (owner, provider, secret) VALUES (?, 'openrouter', ?)").run(owner, key);

  // nothing connected: the paragraphs alone
  assert.equal(await words.write('Что такое молитва?', ['5:1.1'], 10), null);
  assert.deepEqual(words.state(10), { own: null, shared: null });

  // the application's: the shared answers, counted
  connect('app', 'app-key');
  assert.equal(await words.write('Что такое молитва?', ['5:1.1'], 10), 'Молитва — дыхание души (5:1.1).');
  assert.deepEqual([asked[0].key, asked[0].model], ['app-key', BOOK_MODELS[0]]);
  assert.match(asked[0].text, /\[5:1\.1\] Молитва есть дыхание души/, 'from the paragraph, in the question\'s language');
  assert.deepEqual(words.state(10).shared, { left: 1, of: 2 });

  // the first model busy at its source (a 429 not of the day's limit): the next one, the day's answers not spent
  const busy = { status: 429, json: { error: { message: 'Provider returned error', metadata: { raw: 'google/gemma-4-31b-it:free is temporarily rate-limited upstream.' } } } };
  answer = (_k, model) => (model === BOOK_MODELS[0] ? busy : { status: 200, json: { choices: [{ message: { content: 'Второй.' } }] } });
  assert.equal(await words.write('Что такое молитва?', ['5:1.1'], 10), 'Второй.');
  assert.deepEqual(words.state(10).shared, { left: 0, of: 2 });
  assert.equal(await words.write('Что такое молитва?', ['5:1.1'], 10), null, 'none left today: the paragraphs alone');

  // the reader's own: first, and not from the shared answers
  connect('user:10', 'own-key');
  answer = () => ({ status: 200, json: { choices: [{ message: { content: 'Своим.' } }] } });
  assert.equal(await words.write('Что такое молитва?', ['5:1.1'], 10), 'Своим.');
  assert.equal(asked.at(-1)?.key, 'own-key');
  assert.equal(words.state(10).own?.title, 'OpenRouter');

  // the service's limit of the day: no answers of the application left today
  db.prepare("DELETE FROM meta WHERE key = 'ai.shared'").run();
  answer = () => ({ status: 429, json: { error: { message: 'free-models-per-day' } } });
  await assert.rejects(words.write('Что такое молитва?', ['5:1.1'], 11), /закончился/);
  assert.deepEqual(words.state(11).shared, { left: 0, of: 2 });
  delete process.env.UB_AI_SHARED_PER_DAY;
});
