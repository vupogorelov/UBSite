// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDb } from './db.js';
import { createAi } from './ai.js';

test('the AI connected by OAuth (PKCE): the sign-in page, the code becomes a key kept on the server, the model answers', async (t) => {
  const db = openDb(':memory:');
  const ai = createAi(db);
  /** @type {{ url: string, body: any, auth?: string }[]} */
  const sent = [];
  /** @type {(url: string) => { status: number, json: any }} */
  let answer = () => ({ status: 200, json: {} });
  t.mock.method(globalThis, 'fetch', async (/** @type {string} */ url, /** @type {any} */ init) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const a = answer(url);
    return new Response(JSON.stringify(a.json), { status: a.status });
  });

  assert.equal(ai.status('app'), null);
  await assert.rejects(ai.chat('app', 'm', [], { max: 10 }), /не подключена/);

  const page = new URL(ai.begin('app', 'openrouter', 'https://site.example', '/lab'));
  assert.equal(page.origin + page.pathname, 'https://openrouter.ai/auth');
  assert.equal(page.searchParams.get('code_challenge_method'), 'S256');
  const back = new URL(/** @type {string} */ (page.searchParams.get('callback_url')));
  assert.equal(back.origin + back.pathname, 'https://site.example/api/ai/callback/openrouter');
  const state = /** @type {string} */ (back.searchParams.get('state'));

  await assert.rejects(ai.finish('openrouter', 'c', 'other'), /устарел/, 'a state not begun here');
  answer = () => ({ status: 200, json: { key: 'sk-or-123' } });
  assert.equal(await ai.finish('openrouter', 'the-code', state), '/lab');
  const ex = sent.at(-1);
  assert.equal(ex?.url, 'https://openrouter.ai/api/v1/auth/keys');
  assert.equal(createHash('sha256').update(ex?.body.code_verifier).digest('base64url'), page.searchParams.get('code_challenge'), 'the verifier matches the challenge');
  await assert.rejects(ai.finish('openrouter', 'the-code', state), /устарел/, 'a code is used once');
  assert.equal(ai.status('app')?.title, 'OpenRouter');

  answer = () => ({ status: 200, json: { choices: [{ message: { content: ' Ответ (1:0.1). ' } }], usage: { completion_tokens: 7 } } });
  assert.deepEqual(await ai.chat('app', 'google/gemma-4-31b-it:free', [{ role: 'user', content: 'q' }], { max: 100 }), { text: 'Ответ (1:0.1).', tokens: 7 });
  assert.equal(sent.at(-1)?.auth, 'Bearer sk-or-123', 'the key — from the server, with the request');
  answer = () => ({ status: 429, json: { error: { message: 'Rate limit exceeded: free-models-per-day' } } });
  await assert.rejects(ai.chat('app', 'm', [], { max: 10 }), /закончился/);

  ai.disconnect('app');
  assert.equal(ai.status('app'), null);
});
