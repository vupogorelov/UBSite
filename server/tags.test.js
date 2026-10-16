// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { normalizeTagName, hashtagsIn, createTagStore } from './tags.js';
import { parseQuery } from '../shared/search/query.js';

test('tag names', () => {
  assert.equal(normalizeTagName('#Мыслящий_Настройщик'), 'Мыслящий_Настройщик');
  assert.equal(normalizeTagName(' космология / Хавона '), 'космология/Хавона');
  for (const bad of ['', '#', 'a//b', 'с пробелом', 'a/', 'x!']) assert.throws(() => normalizeTagName(bad), bad);
});

test('hashtags in comments', () => {
  assert.deepEqual(hashtagsIn('см. #космология/Хавона и #Рай, а также (#вопрос) но не a#b и не # и #-'), [
    'космология/Хавона',
    'Рай',
    'вопрос',
  ]);
});

test('tag filters in search queries', () => {
  const q = parseQuery('любовь тег:космология,рай #Иисус -тег:вопросы -#черновик');
  assert.deepEqual(q.tags, [['космология', 'рай'], ['иисус']]);
  assert.deepEqual(q.excludeTags, ['вопросы', 'черновик']);
  assert.equal(parseQuery('#космология').clauses.length, 0); // a tag alone is a valid query
});

test('rename moves the subtree and merges into existing tags', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO annotations (id, workspace_id, ref, color) VALUES (1, 1, '1:0.1', 'yellow'), (2, 1, '1:0.2', 'yellow')");
  const tags = createTagStore(db);
  tags.set(1, 1, ['космология/Хавона', 'космология/Рай']);
  tags.set(1, 2, ['Рай', 'космология']);

  // move a subtree under a new parent; "Рай" itself stays
  assert.deepEqual(tags.rename(1, 'космология', 'наука/космология'), { renamed: 3, merged: 0 });
  assert.deepEqual(tags.namesOf(1), ['наука/космология/Рай', 'наука/космология/Хавона']);

  // merge: renaming onto an existing tag (case-insensitive) joins them
  assert.deepEqual(tags.rename(1, 'наука/космология/Рай', 'рай'), { renamed: 0, merged: 1 });
  assert.deepEqual(tags.namesOf(1), ['наука/космология/Хавона', 'Рай']);
  assert.deepEqual([...tags.refsWith(1, 'рай')].sort(), ['1:0.1', '1:0.2']);
  assert.deepEqual([...tags.refsWith(1, 'наука')], ['1:0.1', '1:0.2'].filter((r) => tags.refsWith(1, 'наука').has(r)));

  assert.throws(() => tags.rename(1, 'наука', 'наука/внутри'));
  // "_" in names must not act as a LIKE wildcard
  tags.set(1, 2, ['a_b', 'axb/c']);
  assert.deepEqual([...tags.refsWith(1, 'a_b')], ['1:0.2']);
  assert.equal(tags.remove(1, 'a_b', true), 1);
  assert.deepEqual(tags.namesOf(2), ['axb/c']);
});
