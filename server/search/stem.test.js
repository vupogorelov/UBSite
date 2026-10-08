// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemEn } from './stem-en.js';
import { stemRu } from './stem-ru.js';
import { tokenize, normalizeWord } from './text.js';

test('English Porter2 reference outputs', () => {
  const cases = {
    caresses: 'caress', ponies: 'poni', ties: 'tie', cats: 'cat', feed: 'feed', agreed: 'agre',
    plastered: 'plaster', motoring: 'motor', sing: 'sing', conflated: 'conflat', troubled: 'troubl',
    sized: 'size', hopping: 'hop', falling: 'fall', filing: 'file', happy: 'happi', generously: 'generous',
    consign: 'consign', consigned: 'consign', consigning: 'consign', consignment: 'consign',
    consist: 'consist', consisted: 'consist', consistency: 'consist', consistent: 'consist',
    knack: 'knack', skies: 'sky', dying: 'die', news: 'news', succeeding: 'succeed',
  };
  for (const [word, stem] of Object.entries(cases)) assert.equal(stemEn(word), stem, word);
});

test('English forms of one word share a stem', () => {
  for (const group of [['father', 'fathers'], ['adjuster', 'adjusters'], ['universe', 'universes', 'universal'], ['spirit', 'spirits']]) {
    assert.equal(new Set(group.map(stemEn)).size, 1, group.join());
  }
});

test('Russian forms of one word share a stem', () => {
  const groups = [
    ['вселенная', 'вселенной', 'вселенную', 'вселенные', 'вселенных'],
    ['настройщик', 'настройщика', 'настройщики', 'настройщиков', 'настройщикам'],
    ['божественный', 'божественного', 'божественная', 'божественные'],
    ['духовный', 'духовного', 'духовной', 'духовных'],
    ['любить', 'любит', 'любят', 'любил', 'любила'],
    ['сын', 'сына', 'сыну', 'сыном', 'сыны'],
    ['личность', 'личности', 'личностью', 'личностей'],
  ];
  for (const g of groups) assert.equal(new Set(g.map(stemRu)).size, 1, `${g.join()} → ${g.map(stemRu).join()}`);
});

test('Russian reference outputs', () => {
  const cases = { вселенной: 'вселен', вечного: 'вечн', любовь: 'любов', духовность: 'духовн', прочитавши: 'прочита' };
  for (const [word, stem] of Object.entries(cases)) assert.equal(stemRu(word), stem, word);
});

test('normalization and tokens', () => {
  assert.deepEqual(normalizeWord('Ёлка'), { norm: 'елка', script: 'ru' });
  assert.deepEqual(normalizeWord('cангиков'), { norm: 'сангиков', script: 'ru' }); // Latin "c"
  assert.deepEqual(normalizeWord('Inviсtus'), { norm: 'invictus', script: 'en' }); // Cyrillic "с"
  assert.deepEqual(normalizeWord('Father’s'), { norm: 'fathers', script: 'en' });
  const t = tokenize('Отец — Father’s 1934 пространственно-временных');
  assert.deepEqual(t.map((x) => x.norm), ['отец', 'fathers', '1934', 'пространственно', 'временных']);
  assert.deepEqual(t.map((x) => x.script), ['ru', 'en', 'num', 'ru', 'ru']);
  assert.equal('Отец — Father’s'.slice(t[1].start, t[1].end), 'Father’s');
});
