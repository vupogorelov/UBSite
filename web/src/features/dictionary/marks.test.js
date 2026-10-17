// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstMentions } from './marks.js';

test('the first place of each article in each section, in the reading language', () => {
  // glossary 7 and 8 are two names of article 1 (Михаил, Михаил Небадонский); 9 — article 2; 5 — none
  const articleOf = new Map([[7, 1], [8, 1], [9, 2]]);
  const paras = {
    '33:1.1': { ru: [0, 6, 7, 10, 16, 9, 20, 26, 7], en: [3, 10, 9] },
    '33:1.2': { ru: [0, 6, 8, 12, 15, 5], en: [] },
    '33:2.1': { ru: [4, 10, 8], en: [0, 7, 7] },
  };
  assert.deepEqual(firstMentions(paras, articleOf, 'ru'), [
    { ref: '33:1.1', start: 0, end: 6, article: 1 },
    { ref: '33:1.1', start: 10, end: 16, article: 2 },
    // §2: each article again
    { ref: '33:2.1', start: 4, end: 10, article: 1 },
  ]);
  assert.deepEqual(firstMentions(paras, articleOf, 'en'), [
    { ref: '33:1.1', start: 3, end: 10, article: 2 },
    { ref: '33:2.1', start: 0, end: 7, article: 1 },
  ]);
  assert.deepEqual(firstMentions(paras, new Map(), 'ru'), [], 'no articles — nothing marked');
});
