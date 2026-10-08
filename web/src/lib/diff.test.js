// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff } from './diff.js';

test('word diff keeps the text and marks changes', () => {
  const parts = wordDiff('Хотя приближению к Райскому присутствию', 'Пусть приближение к Раю');
  assert.equal(parts.filter((p) => p.type !== 'del').map((p) => p.text).join(''), 'Пусть приближение к Раю');
  assert.equal(parts.filter((p) => p.type !== 'ins').map((p) => p.text).join(''), 'Хотя приближению к Райскому присутствию');
  assert.deepEqual(parts.find((p) => p.type === 'same'), { type: 'same', text: 'к ' });
});
