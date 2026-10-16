// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createClientLog } from './clientlog.js';

function setup() {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, username, username_key, display_name) VALUES (1, 'anna', 'anna', 'Анна'), (2, 'boris', 'boris', NULL)");
  return createClientLog(db);
}

test("the devices' journal: batches kept by session; sessions newest first with their failures; only failures on request", () => {
  const log = setup();
  const t = (/** @type {number} */ s) => new Date(Date.now() - 3600_000 + s * 1000).toISOString();
  assert.equal(
    log.add(1, { session: 's1', device: 'телефон · приложение 1.4', events: [
      { at: t(1), level: 'info', kind: 'screen', name: '/1' },
      { at: t(2), level: 'info', kind: 'tap', name: 'Слушать' },
      { at: t(3), level: 'error', kind: 'error', name: 'TypeError: x is undefined', data: { stack: 'at f (a.js:1:2)' } },
    ] }),
    3,
  );
  log.add(2, { session: 's2', device: 'компьютер · браузер', events: [{ at: t(10), level: 'info', kind: 'screen', name: '/chat' }] });

  const all = log.list({});
  assert.deepEqual(all.sessions.map((s) => s.session), ['s2', 's1']);
  const s1 = /** @type {any} */ (all.sessions[1]);
  assert.equal(s1.userName, 'Анна');
  assert.equal(s1.errors, 1);
  assert.deepEqual(s1.events.map((/** @type {any} */ e) => e.name), ['/1', 'Слушать', 'TypeError: x is undefined']);
  assert.deepEqual(s1.events[2].data, { stack: 'at f (a.js:1:2)' });
  assert.deepEqual(all.people.map((p) => p.name), ['boris', 'Анна']);

  assert.deepEqual(log.list({ failed: true }).sessions.map((s) => s.session), ['s1']);
  assert.deepEqual(log.list({ user: 2 }).sessions.map((s) => s.session), ['s2']);
});

test('the journal keeps what it is given within bounds', () => {
  const log = setup();
  assert.throws(() => log.add(1, { session: 's', events: 'no' }), /массив/);
  assert.throws(() => log.add(1, { events: [] }), /session/);
  assert.throws(() => log.add(1, { session: 's', events: Array(301).fill({ kind: 'x', name: 'y' }) }), /Не больше 300/);
  // an unknown level is "info"; a long name and data are cut; a time far off is "now"
  log.add(1, { session: 's', device: 'd', events: [{ at: '1999-01-01', level: 'fatal', kind: 'k', name: 'n'.repeat(500), data: 'x'.repeat(9000) }] });
  const e = /** @type {any} */ (log.list({}).sessions[0]).events[0];
  assert.equal(e.level, 'info');
  assert.equal(e.name.length, 160);
  assert.equal(String(e.data).length, 4000);
  assert.ok(e.at.startsWith(new Date().toISOString().slice(0, 10)));
});
