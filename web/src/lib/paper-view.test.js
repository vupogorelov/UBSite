// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tasksPerParagraph, marginMarks, variantLayers, substitutedParagraphs } from './paper-view.js';

const paragraphs = [
  { ref: '5:1.1', ru: 'Отец есть любовь.' },
  { ref: '5:1.2', ru: 'Михаил из Небадона.' },
  { ref: '5:1.3', ru: 'Третий.' },
];

test('tasks per paragraph: open ones only; a range marks each paragraph in it', () => {
  const m = tasksPerParagraph(paragraphs, [
    { status: 'todo', ref: '5:1.1', refEnd: '5:1.3' },
    { status: 'todo', ref: '5:1.2', refEnd: null },
    { status: 'done', ref: '5:1.2', refEnd: null }, // done: not counted
    { status: 'todo', ref: null, refEnd: null }, // not in the book
    { status: 'todo', ref: '9:9.9', refEnd: null }, // another paper
  ]);
  assert.deepEqual([...m], [['5:1.1', 1], ['5:1.2', 2], ['5:1.3', 1]]);
});

test("the margin's marks: a bookmark, comments with the first note that has them, tags", () => {
  const m = marginMarks([
    { id: 1, ref: '5:1.1', bookmark: false, comments: [], tags: ['бог'] },
    { id: 2, ref: '5:1.1', bookmark: true, comments: [{}, {}], tags: ['бог', 'отец'] },
    { id: 3, ref: '5:1.1', bookmark: false, comments: [{}], tags: [] },
  ]);
  const e = m.get('5:1.1');
  assert.ok(e);
  assert.deepEqual([e.bookmark, e.comments, e.firstThread, [...e.tags]], [true, 3, 2, ['бог', 'отец']]);
});

/** @param {Partial<import('./api.js').Proposal>} p @returns {import('./api.js').Proposal} */
const proposal = (p) => /** @type {any} */ ({ id: 1, ref: '5:1.1', start: 0, end: 5, status: 'approved', authorId: 9, text: 'Вариант', original: 'Отец ', ...p });

test('variants in place of the text: the approved as set, one\'s own over them only when asked', () => {
  const live = [proposal({ id: 1 }), proposal({ id: 2, status: 'voting', authorId: 7, start: 0, end: 5 })];
  assert.deepEqual(variantLayers(live, { uid: 7, mine: false, text: 'original' }), []);
  assert.deepEqual(variantLayers(live, { uid: 7, mine: false, text: 'approved' }).map((l) => [l.p.id, l.kind]), [[1, 'approved']]);
  assert.deepEqual(variantLayers(live, { uid: 7, mine: false, text: 'review' }).map((l) => [l.p.id, l.kind]), [[1, 'review']]);
  // one's own under vote over the approved one where they overlap
  assert.deepEqual(variantLayers(live, { uid: 7, mine: true, text: 'approved' }).map((l) => [l.p.id, l.kind]), [[2, 'mine']]);
  assert.deepEqual(variantLayers(live, { uid: undefined, mine: true, text: 'original' }), [], 'a guest has no own variants');
});

test("the paragraphs' HTML: variants and the dictionary's names put in, a name not where a variant stands", () => {
  const plain = (/** @type {string} */ html) => html.replace(/<[^>]*>/g, '');
  const names = [{ written: 'Небадона', alias: 'Небадонской вселенной' }, { written: 'Отец', alias: 'Творец' }];
  const layers = variantLayers([proposal({ id: 1, ref: '5:1.1', start: 0, end: 4, original: 'Отец', text: 'Отче' })], { uid: undefined, mine: false, text: 'approved' });
  const out = substitutedParagraphs(paragraphs, layers, names, plain);
  assert.deepEqual([...out.keys()].sort(), ['5:1.1', '5:1.2'], 'only the paragraphs that have something');
  assert.match(out.get('5:1.1') ?? '', /Отче/);
  assert.doesNotMatch(out.get('5:1.1') ?? '', /Творец/, 'the variant stands there, not the name');
  assert.match(out.get('5:1.2') ?? '', /Небадонской вселенной/);
  assert.equal(substitutedParagraphs(paragraphs, [], [], plain).size, 0, 'nothing on — nothing changed');
});
