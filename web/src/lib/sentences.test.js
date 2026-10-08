import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentences } from './sentences.js';

const split = (t) => sentences(t).map(([a, b]) => t.slice(a, b));

test('splits at sentence ends, keeps abbreviations inside', () => {
  assert.deepEqual(split('Бог есть любовь. Он — Отец всех! Так ли? «Да», — сказал он.'),
    ['Бог есть любовь.', 'Он — Отец всех!', 'Так ли?', '«Да», — сказал он.']);
  assert.deepEqual(split('Это, т. е. сущность, и т. д., а затем всё.'), ['Это, т. е. сущность, и т. д., а затем всё.']);
  assert.deepEqual(split('Конец… — Начало. 3 круга.'), ['Конец…', '— Начало.', '3 круга.']);
  assert.deepEqual(split('God is love. "Yes," he said.'), ['God is love.', '"Yes," he said.']);
  assert.deepEqual(split('  '), []);
  assert.deepEqual(split('Без точки в конце'), ['Без точки в конце']);
});
