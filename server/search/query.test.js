// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, compileRegex, QueryError } from './query.js';
import { snippet } from './engine.js';
import { findFleetingAliases } from './text.js';

test('clauses, alternatives and negation', () => {
  const q = parseQuery('сын | дух ИЛИ отец -бог НЕ ангел');
  assert.equal(q.clauses.length, 3);
  assert.equal(q.clauses[0].alts.length, 3);
  assert.deepEqual(q.clauses.map((c) => c.neg), [false, true, true]);
});

test('languages follow the script of each word', () => {
  const q = parseQuery('настройщик adjuster 1934 язык:en');
  assert.deepEqual(q.clauses.map((c) => c.alts[0].lang), ['ru', 'en', 'en']);
  assert.equal(parseQuery('1934').clauses[0].alts[0].lang, 'both');
});

test('phrases, exact forms, prefixes and proximity', () => {
  const [phrase, exact, prefix] = parseQuery('"дар отца" =бог настрой*').clauses.map((c) => c.alts[0]);
  assert.ok(phrase.kind === 'words' && phrase.words.length === 2 && !phrase.exact);
  assert.ok(exact.kind === 'words' && exact.exact);
  assert.ok(prefix.kind === 'words' && prefix.prefix && prefix.words[0].norm === 'настрой');
  for (const text of ['отец ~5 любовь', 'отец РЯДОМ/5 любовь', 'отец NEAR/5 любовь']) {
    const near = parseQuery(text).clauses[0].alts[0];
    assert.ok(near.kind === 'near' && near.distance === 5 && near.atoms.length === 2, text);
  }
});

test('filters', () => {
  const q = parseQuery('бог часть:1-2 текст:5,120-140 раздел:5:1-3');
  assert.deepEqual([...(q.parts ?? [])], [1, 2]);
  assert.deepEqual(q.papers, [[5, 5], [120, 140]]);
  assert.deepEqual(q.sections, [{ paper: 5, from: 1, to: 3 }]);
});

test('errors are reported in Russian', () => {
  for (const bad of ['-бог', '(бог)', '/abc', 'бог |', 'бог язык:fr', '"father отец"', '/[/']) {
    assert.throws(() => parseQuery(bad), QueryError, bad);
  }
});

test('regex \\w and \\b understand Cyrillic', () => {
  const re = compileRegex('\\bсын\\w*\\b', '');
  assert.deepEqual('Сынами и сыну, несын'.match(re), ['Сынами', 'сыну']);
});

test('snippet marks matches and trims around them', () => {
  const text = 'a'.repeat(400) + ' слово ' + 'b'.repeat(400);
  const seg = snippet(text, [[401, 406]]);
  assert.equal(seg[0][0], '…');
  assert.deepEqual(seg.find(([, m]) => m), ['слово', 1]);
  assert.equal(seg.at(-1)?.[0], '…');
});

test('fleeting vowels are merged only when the book shows both forms', () => {
  const aliases = findFleetingAliases(['Отец любит сына. Отца любят. Любовь и любви. Ангел и Англия.']);
  assert.equal(aliases.get('отец'), 'отц');
  assert.equal(aliases.get('любов'), 'любв');
  assert.equal(aliases.has('ангел'), false);
});
