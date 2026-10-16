// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { registerPlaceRoutes } from './api/places.js';

function setup() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO users (id, username, username_key) VALUES (1, 'a', 'a'), (2, 'b', 'b')`);
  const router = createRouter();
  registerPlaceRoutes(router, db);
  /** @param {string} method @param {string} path @param {number} uid @param {unknown} [body] */
  const call = async (method, path, uid, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { headers: {} });
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ ({}), params: route.params, url, user: /** @type {any} */ ({ id: uid }) }));
  };
  return { call };
}

test('places: per user and kind, the latest wins, validated', async () => {
  const { call } = setup();
  assert.deepEqual(await call('GET', '/api/places', 1), { read: null, listen: null });
  const now = Date.now();
  const phone = { paper: 86, key: '86:5.4', lang: 'ru', progress: 0.5, device: 'phone-123', deviceKind: 'phone', at: now - 1000 };
  assert.equal((await call('PUT', '/api/places/read', 1, phone)).key, '86:5.4');
  // an older place (another device that was offline) does not overwrite a newer one
  await call('PUT', '/api/places/read', 1, { ...phone, key: '5:1.1', paper: 5, device: 'pc-12345', deviceKind: 'computer', at: now - 5000 });
  let p = await call('GET', '/api/places', 1);
  assert.equal(p.read.key, '86:5.4');
  assert.equal(p.read.deviceKind, 'phone');
  assert.equal(p.listen, null);
  // a newer one does; a clock ahead of the server's is pulled back
  await call('PUT', '/api/places/read', 1, { ...phone, key: '86:5.5', device: 'pc-12345', deviceKind: 'computer', at: now + 3_600_000 });
  p = await call('GET', '/api/places', 1);
  assert.equal(p.read.key, '86:5.5');
  assert.ok(p.read.at <= Date.now());
  await call('PUT', '/api/places/listen', 1, { paper: 1, key: 'h0', s: 2, lang: 'en', device: 'pc-12345', deviceKind: 'computer', at: now });
  assert.equal((await call('GET', '/api/places', 1)).listen.s, 2);
  assert.deepEqual(await call('GET', '/api/places', 2), { read: null, listen: null }); // another user's
  await assert.rejects(call('PUT', '/api/places/read', 1, { ...phone, key: '<script>' }), /Неверное место/);
  await assert.rejects(call('PUT', '/api/places/other', 1, phone), /Неизвестный/);
});
