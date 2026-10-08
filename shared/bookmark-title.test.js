import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBookmarkTitle } from './bookmark-title.js';

const P = 'Неспособность конечного создания приблизиться к бесконечному Отцу объясняется не отчужденностью Отца. Духовная пропасть непостижима. Наш Отец не скрывается.';

test('the first words of the sentence the bookmark starts in', () => {
  assert.equal(defaultBookmarkTitle(P, 0), 'Неспособность конечного создания приблизиться к бесконечному…');
  assert.equal(defaultBookmarkTitle(P), 'Неспособность конечного создания приблизиться к бесконечному…');
  assert.equal(defaultBookmarkTitle(P, P.indexOf('пропасть')), 'Духовная пропасть непостижима');
  assert.equal(defaultBookmarkTitle(P, P.indexOf('Отец не')), 'Наш Отец не скрывается');
});

test('short sentences, trailing punctuation, empty text', () => {
  assert.equal(defaultBookmarkTitle('Мир, любовь, свет — и путь, вечный, бесконечный, светлый.'), 'Мир, любовь, свет — и путь…');
  assert.equal(defaultBookmarkTitle(''), '');
});
