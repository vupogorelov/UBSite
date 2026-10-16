// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createOps, validOpId } from './ops.js';

function setup() {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, username, username_key) VALUES (1, 'me', 'me'), (2, 'other', 'other')");
  return createOps(db);
}

test('a change sent again is answered the same and not done twice', async () => {
  const ops = setup();
  let done = 0;
  const fn = async () => ({ status: 200, data: { id: ++done }, keep: true });
  assert.deepEqual(await ops.once(1, 'op-aaaaaaaa', fn), { status: 200, data: { id: 1 } });
  assert.deepEqual(await ops.once(1, 'op-aaaaaaaa', fn), { status: 200, data: { id: 1 } });
  assert.equal(done, 1);
  // another person's change with the same id is theirs
  assert.deepEqual(await ops.once(2, 'op-aaaaaaaa', fn), { status: 200, data: { id: 2 } });
});

test('the same change arriving while it is being done waits for the same answer', async () => {
  const ops = setup();
  let done = 0;
  const fn = async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { status: 200, data: { id: ++done }, keep: true };
  };
  const [a, b] = await Promise.all([ops.once(1, 'op-bbbbbbbb', fn), ops.once(1, 'op-bbbbbbbb', fn)]);
  assert.deepEqual(a, b);
  assert.equal(done, 1);
});

test('a refusal is kept; a failure of the server is not (a repeat tries again)', async () => {
  const ops = setup();
  assert.deepEqual(await ops.once(1, 'op-cccccccc', async () => ({ status: 403, data: { error: 'Нет прав' }, keep: true })), { status: 403, data: { error: 'Нет прав' } });
  assert.deepEqual(await ops.once(1, 'op-cccccccc', async () => ({ status: 200, data: {}, keep: true })), { status: 403, data: { error: 'Нет прав' } });
  await assert.rejects(ops.once(1, 'op-dddddddd', async () => Promise.reject(new Error('boom'))));
  assert.deepEqual(await ops.once(1, 'op-dddddddd', async () => ({ status: 200, data: { ok: true }, keep: true })), { status: 200, data: { ok: true } });
});

test('change ids: letters, digits, "-" and "_", 8 to 64 of them', () => {
  assert.ok(validOpId('0f3c2b9e-7d1a-4c55-9a0e-1b2c3d4e5f60'));
  for (const bad of [undefined, '', 'short', 'x'.repeat(65), 'a b c d e f g h', ['op-aaaaaaaa']]) assert.ok(!validOpId(bad));
});
