import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAliases, unalias } from './aliases.js';

const LIST = [
  { written: 'Салвингтон', alias: 'Спасоград' },
  { written: 'Солитарингтон', alias: 'Град Одиночности' },
  { written: 'Декаполис', alias: 'Десятиградие', forms: { Декаполис: 'Десятиградие', Декаполиса: 'Десятиградия', Декаполисе: 'Десятиградии' } },
];

test('names: endings carried over, forms taken as they are, an alias of two words takes the ending first', () => {
  const t = 'На Салвингтоне, салвингтонский и Салвингтонский совет; Солитарингтона нет; города Декаполиса.';
  const found = findAliases(t, LIST).map((x) => [x.original, x.text]);
  assert.deepEqual(found, [
    ['Салвингтоне', 'Спасограде'],
    ['Салвингтонский', 'Спасоградский'],
    ['Солитарингтона', 'Града Одиночности'],
    ['Декаполиса', 'Десятиградия'],
  ]);
  const one = findAliases('Салвингтона', LIST)[0];
  assert.deepEqual([one.start, one.end], [0, 11]);
  // not inside a word
  assert.deepEqual(findAliases('ПраСалвингтон', LIST), []);
});

test('names: a search for an alias looks for the translation\'s name', () => {
  assert.equal(unalias('центр Спасограда', LIST), 'центр Салвингтона');
  assert.equal(unalias('"Спасоград" и Уверса', LIST), '"Салвингтон" и Уверса');
});
