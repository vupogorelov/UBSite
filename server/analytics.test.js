// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAnalytics, summarize, daily } from './analytics.js';

const T0 = Date.parse('2026-10-01T10:00:00Z');
const min = (/** @type {number} */ n) => T0 + n * 60_000;

test('analytics: minutes → sessions (30-minute gaps), reading and listening, sections; tabs not counted twice', () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO users (id, username, username_key) VALUES (1, 'anna', 'anna'), (2, 'boris', 'boris');
    INSERT INTO channels (id, title) VALUES (9, 'Техподдержка');
  `);
  const a = createAnalytics(db);
  // session 1: 10:00–10:04, reading the book; a second tab in the same minute — one minute
  for (let i = 0; i < 5; i++) a.beat(1, { section: 'book', reading: true }, min(i));
  a.beat(1, { section: 'chat' }, min(4));
  // 20 minutes away — the same session; then the voice reads 3 minutes
  for (let i = 25; i < 28; i++) a.beat(1, { section: 'book', listening: true }, min(i));
  // 2 hours later — session 2, one minute in tasks
  a.beat(1, { section: 'tasks' }, min(150));
  a.beat(1, { section: 'nonsense' }, min(151));

  const s = summarize(/** @type {any} */ (db.prepare('SELECT minute, section, reading, listening FROM activity_minutes WHERE user_id = 1 ORDER BY minute').all()));
  assert.equal(s.sessions, 2);
  assert.equal(s.activeMinutes, 10);
  assert.deepEqual([s.shortest, s.longest], [2, 28]); // 10:00–10:27, 12:30–12:31
  assert.equal(s.average, 15);
  assert.equal(s.reading, 5); // 10:00–10:04; the minute shared with the chat tab stays "reading" (the max of the tabs)
  assert.equal(s.listening, 3);
  assert.equal(s.sections.chat, 1);
  assert.equal(s.sections.other, 1);
  assert.deepEqual(s.devices, {}); // (no device sent: not counted)

  // what people made counts too; the report has both, per person and in sum
  db.exec(`
    INSERT INTO public_messages (ref, author_id, body, mark) VALUES ('chan:9', 2, 'Баг', 'done'), ('chan:9', 2, 'Идея', 'take'), ('chan:1', 1, 'Привет', NULL);
    INSERT INTO tasks (user_id, title) VALUES (1, 'Задача');
  `);
  const r = a.report(0, min(200));
  const anna = r.people.find((p) => p.id === 1);
  const boris = r.people.find((p) => p.id === 2);
  assert.equal(anna?.sessions, 2);
  assert.equal(anna?.messages, 1);
  assert.equal(anna?.tasks, 1);
  assert.deepEqual([boris?.supportTaken, boris?.supportDone], [2, 1]);
  assert.equal(r.totals.activePeople, 1);
  assert.equal(r.totals.sessions, 2);
  assert.equal(r.totals.messages, 3);
  // a period: only its minutes
  assert.equal(a.report(1, min(200)).people.find((p) => p.id === 1)?.sessions, 2);
  assert.throws(() => a.report(-1), /Период/);
});

test('analytics: what the app is opened on — minutes by device; anything else is not counted', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, username, username_key) VALUES (1, 'a', 'a')");
  const a = createAnalytics(db);
  const min = (/** @type {number} */ m) => (29_000_000 + m) * 60_000;
  for (let i = 0; i < 3; i++) a.beat(1, { section: 'book', device: 'phone-app' }, min(i));
  a.beat(1, { section: 'book', device: 'computer-browser' }, min(5));
  a.beat(1, { section: 'book', device: 'fridge' }, min(6));
  const r = a.report(0, min(10));
  assert.deepEqual({ ...r.totals.devices }, { 'phone-app': 3, 'computer-browser': 1 });
  assert.deepEqual({ ...r.people[0].devices }, { 'phone-app': 3, 'computer-browser': 1 });
});

test('analytics: the Android app is a device of its own; the phones by their system (a computer is not counted there)', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, username, username_key) VALUES (1, 'a', 'a')");
  const a = createAnalytics(db);
  const min = (/** @type {number} */ m) => (29_000_000 + m) * 60_000;
  a.beat(1, { section: 'book', device: 'phone-native', os: 'android' }, min(0));
  a.beat(1, { section: 'book', device: 'phone-browser', os: 'android' }, min(1));
  a.beat(1, { section: 'book', device: 'phone-app', os: 'ios' }, min(2));
  a.beat(1, { section: 'book', device: 'computer-browser', os: 'other' }, min(3));
  a.beat(1, { section: 'book', device: 'phone-browser', os: 'symbian' }, min(4));
  const r = a.report(0, min(10));
  assert.deepEqual({ ...r.totals.devices }, { 'phone-native': 1, 'phone-browser': 2, 'phone-app': 1, 'computer-browser': 1 });
  assert.deepEqual({ ...r.totals.phones }, { android: 2, ios: 1 });
});

test('analytics: by day (Moscow time) — people in the app, minutes of reading and listening; empty days too', () => {
  // 2026-10-12 21:30 UTC is already the 13th in Moscow
  const m = (/** @type {string} */ iso) => Date.parse(iso) / 60_000;
  const rows = [
    { userId: 1, minute: m('2026-10-11T10:00:00Z'), reading: 1, listening: 0 },
    { userId: 1, minute: m('2026-10-11T10:01:00Z'), reading: 1, listening: 1 },
    { userId: 2, minute: m('2026-10-11T12:00:00Z'), reading: 0, listening: 1 },
    { userId: 2, minute: m('2026-10-12T21:30:00Z'), reading: 1, listening: 0 },
  ];
  const d = daily(rows, m('2026-10-11T00:00:00Z'), m('2026-10-13T12:00:00Z'));
  assert.deepEqual(d, [
    { day: '2026-10-11', people: 2, reading: 2, listening: 2 },
    { day: '2026-10-12', people: 0, reading: 0, listening: 0 },
    { day: '2026-10-13', people: 1, reading: 1, listening: 0 },
  ]);
});
