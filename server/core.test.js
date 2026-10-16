// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createCore } from './core.js';
import { FEATURES } from './features/index.js';

test('the core: guest paths, interceptors, events between features, jobs that keep going after a failure', async (t) => {
  const core = createCore(openDb(':memory:'));
  core.guest(/^\/api\/open$/);
  assert.equal(core.isGuestPath('/api/open'), true);
  assert.equal(core.isGuestPath('/api/closed'), false);

  /** @type {string[]} */ const said = [];
  core.intercept((_req, _res, path) => (said.push(`a:${path}`), false));
  core.intercept((_req, _res, path) => (said.push(`b:${path}`), path === '/x'));
  core.intercept((_req, _res, path) => (said.push(`c:${path}`), false));
  assert.equal(core.intercepted(/** @type {any} */ ({}), /** @type {any} */ ({}), '/x'), true);
  assert.deepEqual(said, ['a:/x', 'b:/x'], 'the first that answers ends it');

  /** @type {string[]} */ const heard = [];
  core.on('bookChanged', () => heard.push('book'));
  core.on('bookChanged', () => heard.push('offline'));
  core.emit('bookChanged');
  core.emit('nobodyListens');
  assert.deepEqual(heard, ['book', 'offline'], 'in the order they listened');

  t.mock.timers.enable({ apis: ['setInterval'] });
  const errors = t.mock.method(console, 'error', () => {});
  let runs = 0;
  core.every(1000, 'Flaky job', () => {
    runs++;
    throw new Error('once');
  });
  core.startJobs();
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 2, 'a failure does not stop the next run');
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /Flaky job failed/);
});

test("the platform's features set up on the core: every one, the routes in place, the guest paths opened", () => {
  process.env.UB_DB = ':memory:'; // (the search's worker opens its own database: not the real one in a test)
  const core = createCore(openDb(':memory:'));
  const names = FEATURES.map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'each feature once');
  for (const f of FEATURES) f.setup(core);
  for (const [method, path] of [['GET', '/api/toc'], ['GET', '/api/papers/5'], ['POST', '/api/tasks'], ['GET', '/api/chat/stream'], ['GET', '/api/health'], ['GET', '/api/offline/manifest']]) {
    assert.ok(core.router.match(method, path), `${method} ${path}`);
  }
  for (const p of ['/api/toc', '/api/papers/5', '/api/guest/paper/5', '/api/health']) assert.equal(core.isGuestPath(p), true, p);
  assert.equal(core.isGuestPath('/api/workspaces'), false);
});
