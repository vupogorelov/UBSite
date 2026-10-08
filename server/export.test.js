// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editionRuns } from './export.js';

const change = (/** @type {number} */ start, /** @type {number} */ end, /** @type {string} */ text) =>
  ({ id: 1, ref: '1:1.1', start, end, original: '', text, author: 'a', decidedAt: '2026-10-06 10:00:00', votes: { for: 3, against: 0, abstain: 0 } });

test('edition runs: the fragment is replaced, italics and entities are kept', () => {
  const runs = editionRuns('аб <i>вг де</i> жз &amp; и', [change(5, 10, 'X')]);
  const clean = runs.filter((r) => r.kind !== 'del').map((r) => r.text).join('');
  const all = runs.filter((r) => r.kind !== 'ins').map((r) => r.text).join('');
  assert.equal(clean, 'аб вгXз & и');
  assert.equal(all, 'аб вг де жз & и'); // the original is intact under "del"
  assert.deepEqual(runs.filter((r) => r.kind === 'del').map((r) => [r.text, r.italic]), [[' де', true], [' ж', false]]);
  assert.equal(runs.find((r) => r.kind === 'ins')?.text, 'X');
  // a change reaching the very end
  assert.equal(editionRuns('abc', [change(1, 3, 'Z')]).filter((r) => r.kind !== 'del').map((r) => r.text).join(''), 'aZ');
});

