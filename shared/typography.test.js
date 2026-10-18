// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepNumbers } from './typography.js';

test("a number's groups of digits keep together; the length and the tags stay as they were", () => {
  const html = 'творением 611 121-й концепции, <i>1 000 000</i> лет; в 1934 году 12 человек';
  const out = keepNumbers(html);
  assert.equal(out, 'творением 611 121-й концепции, <i>1 000 000</i> лет; в 1934 году 12 человек');
  assert.equal(out.length, html.length, 'a character for a character');
  assert.equal(keepNumbers('<span data-x="1 234">5 678</span>'), '<span data-x="1 234">5 678</span>', 'not inside a tag');
  assert.equal(keepNumbers('в 12 345 6789'), 'в 12 345 6789', 'a group is three digits');
});
