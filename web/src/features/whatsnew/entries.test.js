// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, dateText } from './entries.js';

test('whatsnew.md: entries by date, the newest first; the points\' bold words for the bell', () => {
  const md = '# Что нового\n\nВступление.\n\n## 2026-10-17\n\n- **Словарь книги:** статьи.\n\n## 2026-10-18\n\n- **Таймер сна** в плеере.\n- Без жирного.\n';
  const e = parse(md);
  assert.deepEqual(e.map((x) => x.date), ['2026-10-18', '2026-10-17']);
  assert.deepEqual(e[0].titles, ['Таймер сна']);
  assert.deepEqual(e[1].titles, ['Словарь книги'], '(the colon after it goes)');
  assert.ok(e[0].html.includes('<li>') && !e[0].html.includes('Вступление'));
  assert.equal(dateText('2026-10-18'), '18 октября 2026');
});

test('the project\'s whatsnew.md is read: dated entries, each with points', () => {
  const e = parse(readFileSync(new URL('../../../../whatsnew.md', import.meta.url), 'utf8'));
  assert.ok(e.length > 0);
  for (const x of e) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.titles.length > 0, x.date);
});
