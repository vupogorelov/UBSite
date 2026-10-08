// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { substituteHtml, pickNonOverlapping, layer } from './substitute.js';

/** textContent of our HTML: tags removed, entities decoded. @param {string} html */
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('the original text (and so every offset) is unchanged; the variant goes to data-text', () => {
  const html = 'Один &amp; <i>два три</i> четыре';
  const out = substituteHtml(html, [{ id: 7, start: 7, end: 10, text: '2 "x"' }]);
  assert.equal(text(out), text(html));
  assert.match(out, /data-pid="7" data-text="2 &quot;x&quot;"/);
});

test('italics crossing a fragment boundary stay well nested', () => {
  const out = substituteHtml('аб <i>вг де</i> жз', [{ id: 1, start: 5, end: 10, text: 'X', original: ' де ж' }]);
  assert.equal(out, 'аб <i>вг</i><span class="tr-sub tr-mine" data-pid="1" data-text="X" data-orig=" де ж"><span class="tr-orig"><i> де</i> ж</span></span>з');
});

test('fragments at the start and the very end of a paragraph', () => {
  const out = substituteHtml('abc def', [{ id: 2, start: 4, end: 7, text: 'Z' }, { id: 1, start: 0, end: 3, text: 'Y' }]);
  assert.equal(text(out), 'abc def');
  assert.equal((out.match(/class="tr-sub tr-mine"/g) ?? []).length, 2);
  assert.ok(out.endsWith('def</span></span>'));
});

test('overlapping variants: the most recently changed wins', () => {
  const picked = pickNonOverlapping([
    { id: 1, start: 0, end: 10, updatedAt: '2026-10-06 10:00:00' },
    { id: 2, start: 5, end: 15, updatedAt: '2026-10-06 11:00:00' },
    { id: 3, start: 20, end: 25, updatedAt: '2026-10-06 09:00:00' },
  ]);
  assert.deepEqual(picked.map((p) => p.id).sort(), [2, 3]);
});

test('own variants are laid over the approved ones; an overlapped approved fragment is left out', () => {
  const mine = [{ id: 1, start: 5, end: 10 }];
  const approved = [{ id: 2, start: 0, end: 6 }, { id: 3, start: 10, end: 12 }];
  assert.deepEqual(layer(mine, approved).map((p) => p.id), [1, 3]);
});

test('kind sets the class of the fragment', () => {
  assert.match(substituteHtml('abc', [{ id: 1, start: 0, end: 3, text: 'X', kind: 'review' }]), /class="tr-sub tr-review"/);
});
