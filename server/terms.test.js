// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termMatchers, findTerms } from './terms.js';

const TERMS = [
  { id: 1, en: 'Adam', ru: 'Адам' },
  { id: 2, en: 'Egypt', ru: 'Египет' },
  { id: 3, en: 'Supreme Being', ru: 'Верховное Существо' },
  { id: 4, en: 'Ancients of Days', ru: 'Древние Дней' },
  { id: 5, en: 'Supreme', ru: 'Верховный' },
];
const m = termMatchers(TERMS);
const words = (/** @type {string} */ text, /** @type {'ru' | 'en'} */ lang) => findTerms(text, m[lang]).map(([s, e, id]) => `${text.slice(s, e)}:${id}`);

test('terms: Russian forms by their beginning and ending, the longest term first', () => {
  assert.deepEqual(words('Адам и Адама, из Египта в Египет; Верховного Существа и Верховный.', 'ru'),
    ['Адам:1', 'Адама:1', 'Египта:2', 'Египет:2', 'Верховного Существа:3', 'Верховный:5']);
  // a capitalized term only so written; not a longer word; not across a comma
  assert.deepEqual(words('адам, Адамсон, Верховного, Существа', 'ru'), ['Верховного:5']);
  assert.deepEqual(words('Древних Дней', 'ru'), ['Древних Дней:4']);
});

test('terms: English by stems, joined words included', () => {
  assert.deepEqual(words('The Ancients of Days and the Supreme Being; the Supreme.', 'en'),
    ['Ancients of Days:4', 'Supreme Being:3', 'Supreme:5']);
});

test('terms: names sharing a stem are told by their declension; an adjective of a name', () => {
  const mm = termMatchers([{ id: 1, en: 'Satan', ru: 'Сатана' }, { id: 2, en: 'Satania', ru: 'Сатания' }, { id: 3, en: 'Paradise', ru: 'Рай' }]);
  const text = 'Сатана и Сатаной, в Сатании; Райские Сыны и Рая.';
  assert.deepEqual(findTerms(text, mm.ru).map(([s, e, id]) => `${text.slice(s, e)}:${id}`), ['Сатана:1', 'Сатаной:1', 'Сатании:2', 'Райские:3', 'Рая:3']);
});
