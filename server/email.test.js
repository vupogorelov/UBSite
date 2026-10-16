// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { createMailer } from './mail.js';
import { registerAuthRoutes } from './api/auth.js';

test('e-mail: confirming an address, a forgotten password by a letter, no hints, limits', async () => {
  const outbox = mkdtempSync(join(tmpdir(), 'ub-outbox-'));
  const db = openDb(':memory:');
  const auth = createAuth(db);
  const router = createRouter();
  registerAuthRoutes(router, db, auth, createMailer({ outbox, from: 'box@example.ru', name: 'UPE' }));
  /** @type {string | null} */ let cookie = null;
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const url = new URL(path, 'http://x');
    const route = router.match(method, url.pathname);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      headers: { host: 'upexplorer.test', ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: '10.0.0.1' },
    });
    const res = { setHeader: (/** @type {string} */ k, /** @type {string} */ v) => k === 'Set-Cookie' && (cookie = v.split(';')[0]) };
    return /** @type {any} */ (await route.handler({ req: /** @type {any} */ (req), res: /** @type {any} */ (res), params: route.params, url, user: /** @type {any} */ (null) }));
  };
  /** The links in the letters, newest last. */
  const links = () =>
    readdirSync(outbox).sort().map((f) => {
      const eml = readFileSync(join(outbox, f), 'utf8');
      const text = Buffer.from(eml.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString();
      return /** @type {string} */ (text.match(/http\S+/)?.[0]);
    });

  assert.deepEqual(await call('GET', '/api/auth/registration'), { open: true, mail: true });
  // sign-up with an address: the account is there at once, the address is to be confirmed
  const reg = await call('POST', '/api/auth/register', { username: 'anna', password: 'password1', email: 'Anna@Example.org' });
  assert.equal(reg.user.email, 'Anna@Example.org');
  assert.equal(reg.user.emailVerified, false);
  assert.equal(reg.emailSent, true);
  const verifyLink = links()[0];
  assert.match(verifyLink, /^http:\/\/upexplorer\.test\/verify-email\//);

  // not confirmed yet: "forgot" sends nothing — and says the same
  assert.deepEqual(await call('POST', '/api/auth/forgot', { login: 'anna' }), { ok: true });
  assert.equal(links().length, 1);

  // the link confirms it, once
  const token = verifyLink.split('/').pop();
  assert.deepEqual(await call('POST', `/api/auth/verify-email/${token}`), { email: 'Anna@Example.org' });
  await assert.rejects(call('POST', `/api/auth/verify-email/${token}`), /недействительна/);
  assert.equal((await call('GET', '/api/auth/me')).user.emailVerified, true);

  // forgot — by the e-mail (any case) and by the name; an unknown one gets the same answer and no letter
  assert.deepEqual(await call('POST', '/api/auth/forgot', { login: 'ANNA@example.org' }), { ok: true });
  assert.deepEqual(await call('POST', '/api/auth/forgot', { login: 'nobody' }), { ok: true });
  assert.equal(links().length, 2);
  const reset = links()[1];
  assert.match(reset, /\/invite\//);
  // the link sets a new password and signs in; an old password no longer works
  const inviteToken = reset.split('/').pop();
  assert.equal((await call('GET', `/api/auth/invite/${inviteToken}`)).kind, 'reset');
  await call('POST', `/api/auth/invite/${inviteToken}`, { password: 'new-password' });
  assert.equal(auth.login('anna', 'password1'), null);
  assert.ok(auth.login('anna', 'new-password'));
  // the reset link lives an hour
  const row = /** @type {any} */ (db.prepare("SELECT (julianday(expires_at) - julianday('now')) * 24 AS h FROM invites WHERE kind = 'reset'").get());
  assert.ok(row.h > 0.9 && row.h <= 1.01);

  // changing the address needs the password, and makes it unconfirmed (an old link does not confirm the new one)
  await assert.rejects(call('PUT', '/api/auth/email', { email: 'new@example.org', password: 'wrong' }), /Пароль неверен/);
  const changed = await call('PUT', '/api/auth/email', { email: 'new@example.org', password: 'new-password' });
  assert.equal(changed.user.emailVerified, false);
  await assert.rejects(call('PUT', '/api/auth/email', { email: 'bad-address', password: 'new-password' }), /Почта/);

  // the letters per account are limited (3 an hour): the confirmation of the new address was the 3rd for anna
  // (the sign-up one, the reset, this) — one more is refused
  await assert.rejects(call('POST', '/api/auth/email/resend'), /несколько раз/);
  rmSync(outbox, { recursive: true, force: true });
});
