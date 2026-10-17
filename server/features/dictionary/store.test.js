// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../db.js';
import { createGlossary } from '../../glossary.js';
import { createTermIndex } from '../../terms.js';
import { createDictionary } from './store.js';

function setup() {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Небесный Отец', 'The Father'), (6, 1, 'Рай', 'Paradise');
    INSERT INTO sections (paper_id, num, title_ru, title_en) VALUES (5, 1, 'Раздел', 'Section'), (6, 1, 'Раздел', 'Section');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '1.1', '', '', 'Мелхиседек пришёл на Урантию.', 'Machiventa Melchizedek came to Urantia.'),
      ('5:1.2', 2, 5, 1, 2, '1.2', '', '', 'Ничего о нём.', 'Nothing about him.'),
      ('6:1.1', 3, 6, 1, 1, '2.1', '', '', 'Мелхиседек — это учитель Авраама.', 'Melchizedek was the teacher of Abraham.'),
      ('6:1.2', 4, 6, 1, 2, '2.2', '', '', 'Урантия — планета.', 'Urantia is a planet.');
    INSERT INTO glossary (id, en, ru) VALUES (1, 'Melchizedek', 'Мелхиседек'), (2, 'Urantia', 'Урантия'), (3, 'Abraham', 'Авраам');
    INSERT INTO users (id, username, username_key, is_coordinator) VALUES (1, 'coord', 'coord', 1), (2, 'reader', 'reader', 0);
  `);
  const glossary = createGlossary(db);
  const dict = createDictionary(db, glossary, createTermIndex(db, glossary));
  const coord = /** @type {any} */ ({ id: 1, isCoordinator: true, isAdmin: false });
  const reader = /** @type {any} */ ({ id: 2, isCoordinator: false, isAdmin: false });
  return { db, dict, coord, reader };
}

test("an article from the glossary's name: its places in the whole book, by paper, the first of them", async () => {
  const { dict, coord } = setup();
  const id = dict.create({ nameRu: 'Мелхиседек', nameEn: 'Melchizedek', kind: 'person', glossaryIds: [1] }, coord);
  const a = /** @type {any} */ (await dict.get(id, true));
  assert.deepEqual(a.names.map((/** @type {any} */ n) => n.ru), ['Мелхиседек']);
  assert.equal(a.occurrences.paragraphs, 2);
  assert.equal(a.occurrences.first, '5:1.1');
  assert.deepEqual(a.occurrences.byPaper.map((/** @type {any} */ p) => [p.paper, p.refs]), [[5, ['5:1.1']], [6, ['6:1.1']]]);
});

test('a draft is the coordinators\'; published — everyone\'s, a guest too', async () => {
  const { dict, coord, reader } = setup();
  const id = dict.create({ nameRu: 'Урантия', glossaryIds: [2] }, coord);
  assert.equal((await dict.list(false)).length, 0, 'the public list: no drafts');
  assert.equal((await dict.list(true)).length, 1, "a coordinator's, with the drafts");
  await assert.rejects(() => dict.get(id, false), /нет в словаре/);
  dict.update(id, { briefRu: 'Наша планета.', status: 'published' }, coord);
  assert.deepEqual((await dict.list(false)).map((a) => [a.nameRu, a.briefRu, a.paragraphs]), [['Урантия', 'Наша планета.', 2]]);
  assert.throws(() => dict.update(id, { briefRu: 'x' }, reader), /координаторы/, 'a reader cannot change it, published or not');
});

test('"Что это?": the article of selected words — by a form of its name, in either language; none — null', () => {
  const { dict, coord, reader } = setup();
  const id = dict.create({ nameRu: 'Мелхиседек', glossaryIds: [1] }, coord);
  dict.update(id, { status: 'published', briefRu: 'Сын Божий, служивший на Урантии.' }, coord);
  assert.equal(dict.lookup('Мелхиседека', 'ru', reader)?.id, id, 'a form of the name');
  assert.equal(dict.lookup('Machiventa Melchizedek', 'en', reader)?.id, id);
  assert.equal(dict.lookup('учитель', 'ru', reader), null);
  const urantia = dict.create({ nameRu: 'Урантия', glossaryIds: [2] }, coord); // a draft
  assert.equal(dict.lookup('Урантия', 'ru', reader), null, 'a draft is not found by a reader');
  assert.equal(dict.lookup('Урантия', 'ru', coord)?.id, urantia);
});

test('the main places: hints — the first mention and what says what it is; chosen, in order; each paragraph checked', async () => {
  const { dict, coord } = setup();
  const id = dict.create({ nameRu: 'Мелхиседек', glossaryIds: [1] }, coord);
  const hints = await dict.hints(id, coord);
  assert.deepEqual(hints.map((h) => [h.ref, h.first]), [['5:1.1', true], ['6:1.1', false]]); // «Мелхиседек — это…»
  dict.setPlaces(id, [{ ref: '6:1.1', note: 'кто он' }, { ref: '5:1.1' }], coord);
  const a = /** @type {any} */ (await dict.get(id, true));
  assert.deepEqual(a.places.map((/** @type {any} */ p) => [p.ref, p.note]), [['6:1.1', 'кто он'], ['5:1.1', '']]);
  assert.throws(() => dict.setPlaces(id, [{ ref: '9:9.9' }], coord), /Нет такого абзаца/);
});

test('a name belongs to one article; related articles, a draft one hidden from a reader', async () => {
  const { dict, coord, reader } = setup();
  const m = dict.create({ nameRu: 'Мелхиседек', glossaryIds: [1] }, coord);
  const ab = dict.create({ nameRu: 'Авраам', glossaryIds: [3] }, coord);
  assert.throws(() => dict.create({ nameRu: 'Ещё Мелхиседек', glossaryIds: [1] }, coord), /уже в другой статье/);
  dict.setLinks(m, [{ id: ab, kind: 'related' }], coord);
  dict.update(m, { status: 'published' }, coord);
  assert.deepEqual((/** @type {any} */ (await dict.get(m, true))).links.map((/** @type {any} */ l) => l.nameRu), ['Авраам']);
  assert.deepEqual((await dict.get(m, false)).links, [], 'Авраам is still a draft');
  assert.deepEqual((await dict.candidates()).map((c) => c.ru), ['Урантия'], 'the names no article has, the most named first');
});
