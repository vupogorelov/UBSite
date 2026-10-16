// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexOf, shareIn, placeIn } from './bookindex.js';

// three papers: 4, 0 (no paragraphs) and 6 paragraphs — 10 in the book
const index = indexOf({ papers: [{ id: 0, paragraphs: 4 }, { id: 1, paragraphs: 0 }, { id: 2, paragraphs: 6 }] });

test("the book's map: a place is a share of the book, a share is a place", () => {
  assert.equal(index.total, 10);
  assert.equal(shareIn(index, 0, 0), 0);
  assert.equal(shareIn(index, 2, 1), 0.5); // 4 before paper 2, its second paragraph
  assert.equal(shareIn(index, 2, 2.5), 0.65); // half way through a paragraph
  assert.equal(shareIn(index, 2, 99), 1, 'not past the end');
  assert.equal(shareIn(null, 2, 1), null, 'no map yet');
  assert.deepEqual(placeIn(index, 0), { paper: 0, idx: 0 });
  assert.deepEqual(placeIn(index, 0.45), { paper: 2, idx: 0 }, 'a paper with no paragraphs is passed over');
  assert.deepEqual(placeIn(index, 1), { paper: 2, idx: 5 }, 'the very end: the last paragraph');
  assert.equal(placeIn(null, 0.5), null);
});
