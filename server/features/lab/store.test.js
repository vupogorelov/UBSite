// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db.js';
import { createLab, mix } from './store.js';

/** The models compared (the platform keeps one): two of the mixed search, one of full precision. */
const MODELS = [
  { id: 'gemma', title: 'Gemma', size: '', query: 'q: {}', passage: 'p: {}', mix: true, book: true, spec: { name: 'g/gemma', pooling: /** @type {const} */ ('sentence') } },
  { id: 'e5-base', title: 'e5', size: '', query: 'q: {}', passage: 'p: {}', mix: true, spec: { name: 'x/e5', pooling: /** @type {const} */ ('mean') } },
  { id: 'berta', title: 'BERTA', size: '', query: 'q: {}', passage: 'p: {}', spec: { name: 's/berta', dtype: 'fp32', pooling: /** @type {const} */ ('mean') } },
];

/** A model of its own: the meaning is which of three words a text has (a vector of three numbers). */
const fakeEngine = () => ({
  installed: () => true,
  running: () => false,
  stop() {},
  /** @param {unknown} _spec @param {string[]} texts */
  async embed(_spec, texts) {
    const words = ['смерт', 'дет', 'люцифер'];
    const vectors = new Float32Array(texts.length * 3);
    texts.forEach((t, i) => {
      const v = words.map((w) => (t.toLowerCase().includes(w) ? 1 : 0.01));
      const len = Math.hypot(...v);
      v.forEach((x, k) => (vectors[i * 3 + k] = x / len));
    });
    return { vectors, dims: 3 };
  },
});

test('the Laboratory: one judgement per paragraph (the old per-column marks where they agree), the mixed column, the score', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (47, 1, 'Обители', 'Mansions');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('47:2.7', 1, 47, 2, 7, '1', '', '', 'Дети после смерти растут в мирах.', 'Children after death.'),
      ('47:2.8', 2, 47, 2, 8, '2', '', '', 'После смерти — пробуждение.', 'After death.'),
      ('47:2.9', 3, 47, 2, 9, '3', '', '', 'Люцифер восстал.', 'Lucifer rebelled.');
  `);
  const dir = mkdtempSync(join(tmpdir(), 'lab-'));
  try {
    // the first marks, per column: 47:2.7 agreed, 47:2.8 not
    const old = new DatabaseSync(join(dir, 'lab.db'));
    old.exec(`CREATE TABLE marks (question TEXT NOT NULL, model TEXT NOT NULL, ref TEXT NOT NULL, good INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (question, model, ref)) WITHOUT ROWID;
      INSERT INTO marks (question, model, ref, good) VALUES ('дети', 'e5-base', '47:2.7', 1), ('дети', 'words', '47:2.7', 1),
        ('дети', 'e5-base', '47:2.8', 1), ('дети', 'words', '47:2.8', 0);`);
    old.close();

    const lab = createLab(db, /** @type {any} */ (fakeEngine()), { file: join(dir, 'lab.db'), models: dir }, MODELS);
    // models asked for while another works: in turn
    lab.run('e5-base');
    lab.run('gemma');
    const model = (/** @type {string} */ id) => lab.status().models.find((m) => m.id === id);
    assert.equal(model('gemma')?.queued, true);
    for (let i = 0; i < 200 && model('gemma')?.done !== 6; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual([model('e5-base')?.done, model('gemma')?.done], [6, 6], 'each worked out in turn: both languages of the three paragraphs');

    const a = await lab.ask('что с детьми после смерти', () => [{ ref: '47:2.8' }, { ref: '47:2.9' }]);
    assert.deepEqual(a.columns.map((c) => c.id), ['gemma', 'e5-base', 'mix', 'words']);
    const found = (/** @type {string} */ id) => /** @type {any} */ (a.columns.find((c) => c.id === id)).found.map((/** @type {any} */ f) => f.ref);
    assert.equal(found('e5-base')[0], '47:2.7', 'the closest by meaning first');
    assert.deepEqual(new Set(found('mix')), new Set(['47:2.7', '47:2.8', '47:2.9']), 'the mixed: both lists');

    lab.judge({ question: 'что с детьми после смерти', ref: '47:2.7', good: true });
    lab.judge({ question: 'что с детьми после смерти', ref: '47:2.9', good: false });
    const s = lab.status();
    const of = (/** @type {string} */ col) => s.score.find((x) => x.col === col);
    assert.deepEqual([of('e5-base')?.top3, of('e5-base')?.good, of('e5-base')?.bad], [1, 1, 1]);
    assert.deepEqual([of('words')?.answered, of('words')?.bad, of('words')?.open], [0, 1, 1], 'the word search missed it');
    assert.equal(s.questions.find((x) => x.text === 'что с детьми после смерти')?.good, 1);
    const todo = lab.todo().find((t) => t.question === 'что с детьми после смерти');
    assert.deepEqual(todo?.items.map((x) => x.ref), ['47:2.8'], 'left to judge: each paragraph once, the judged ones not');
    assert.ok((todo?.items[0].by.length ?? 0) >= 2, 'found by several columns — shown once, with each place');

    // the platform's search: by meaning — the model's closest; the hybrid — its first two, then the words' too
    assert.deepEqual(await lab.find('что с детьми после смерти', 'meaning', 1, () => []), ['47:2.7']);
    const hybrid = (await lab.find('что с детьми после смерти', 'hybrid', 3, () => [{ ref: '47:2.9' }])) ?? [];
    assert.equal(hybrid[0], '47:2.7');
    assert.ok(hybrid.includes('47:2.9'), 'what the words found joins in');

    // «Я и Книга»: by its model alone, kept as the column 'book' of the score
    assert.deepEqual(await lab.bookAnswer('что с детьми после смерти', 1), ['47:2.7']);
    assert.equal(lab.status().score.find((x) => x.col === 'book')?.top3, 1);

    const kept = new DatabaseSync(join(dir, 'lab.db'), { readOnly: true });
    assert.deepEqual(kept.prepare("SELECT ref, good FROM judged WHERE question = 'дети'").all().map((r) => ({ ...r })), [{ ref: '47:2.7', good: 1 }], 'the old marks: only where the columns agreed');
    kept.close();
    lab.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Laboratory: all models at once, the threads shared by the ones on the processor, the video card for full precision', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (47, 1, 'Обители', 'Mansions');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('47:2.7', 1, 47, 2, 7, '1', '', '', 'Дети после смерти.', 'Children after death.');
  `);
  const dir = mkdtempSync(join(tmpdir(), 'lab-'));
  try {
    /** What each model's batch was asked with. @type {Map<string, { device?: string, threads?: number }>} */
    const seen = new Map();
    let release = () => {};
    const gate = new Promise((r) => (release = () => r(undefined)));
    const engine = fakeEngine();
    const lab = createLab(db, /** @type {any} */ ({
      ...engine,
      /** @param {any} spec @param {string[]} texts @param {any} opts */
      async embed(spec, texts, opts) {
        seen.set(spec.name, { device: spec.device, threads: opts?.threads });
        await gate;
        return engine.embed(spec, texts);
      },
    }), { file: join(dir, 'lab.db'), models: dir }, MODELS);
    assert.throws(() => lab.configure({ threads: 17 }), /от 1 до 16/);
    lab.configure({ threads: 12, gpu: true, together: true });
    lab.runAll();
    const s = lab.status();
    assert.ok(s.models.every((m) => m.running), 'all at once');
    const of = (/** @type {string} */ id) => /** @type {any} */ (s.models.find((m) => m.id === id));
    const onCpu = s.models.filter((m) => m.device === 'cpu').length;
    assert.deepEqual([of('berta').device, of('gemma').device], ['gpu', 'cpu'], 'the video card: full precision only');
    assert.equal(of('gemma').threads, Math.floor(12 / onCpu), "the processor's threads shared");
    assert.equal(seen.get('s/berta')?.device, 'dml');
    release();
    for (let i = 0; i < 200 && lab.status().models.some((m) => m.running); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(lab.status().models.every((m) => m.done === 2), 'each worked out');
    lab.close();
    const again = createLab(db, /** @type {any} */ (fakeEngine()), { file: join(dir, 'lab.db'), models: dir }, MODELS);
    assert.deepEqual(again.status().settings, { threads: 12, gpu: true, together: true, maxThreads: 16 }, 'the settings kept');
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Laboratory: a writing model answers the saved questions from the paragraphs found; the answers judged', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (47, 1, 'Обители', 'Mansions');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('47:2.7', 1, 47, 2, 7, '1', '', '', 'Дети после смерти растут в мирах.', 'Children after death.'),
      ('47:2.9', 2, 47, 2, 9, '2', '', '', 'Люцифер восстал.', 'Lucifer rebelled.');
  `);
  const dir = mkdtempSync(join(tmpdir(), 'lab-'));
  try {
    /** @type {any[]} */
    const asked = [];
    // the remote AI (server/ai.js), connected: the model's name, the conversation
    const ai = async (/** @type {string} */ model, /** @type {any[]} */ messages) => (asked.push({ model, messages }), { text: 'Дети растут в мирах (47:2.7).', tokens: 9 });
    const WRITERS = [{ id: 'w', title: 'W', size: 'OpenRouter', remote: { model: 'x/w:free' } }];
    const lab = createLab(db, /** @type {any} */ (fakeEngine()), { file: join(dir, 'lab.db'), models: dir, ai, aiReady: () => true }, MODELS, WRITERS);
    assert.throws(() => lab.write('w'), /Сначала посчитайте/, 'without the vectors there is nothing to answer from');
    lab.run('gemma');
    for (let i = 0; i < 200 && lab.status().models.some((m) => m.running); i++) await new Promise((r) => setTimeout(r, 20));
    lab.addQuestion('что с детьми после смерти');
    lab.write('w');
    for (let i = 0; i < 200 && lab.status().writers[0].running; i++) await new Promise((r) => setTimeout(r, 20));
    const r = lab.replies();
    assert.equal(r[0].refs[0], '47:2.7', 'from the paragraphs the Book finds, the closest first');
    assert.equal(asked[0].model, 'x/w:free');
    assert.match(asked[0].messages.at(-1).content, /\[47:2\.7\] Дети после смерти/, 'the paragraphs given, with their numbers, in the question\'s language');
    assert.equal(r[0].answers.w.text, 'Дети растут в мирах (47:2.7).');
    lab.judgeReply({ question: 'что с детьми после смерти', model: 'w', good: true });
    assert.deepEqual([lab.status().writers[0].answered, lab.status().writers[0].good], [1, 1]);
    lab.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the mixed search: the model's first two stay; the words add what it missed, not taking its places", async () => {
  const model = ['a', 'b', 'c', 'd', 'e'];
  const words = ['x', 'c', 'y'];
  const out = mix(model, words);
  assert.deepEqual(out.slice(0, 2), ['a', 'b'], "the model's first two");
  assert.equal(out[2], 'c', 'found by both — next');
  assert.ok(out.includes('x') && out.includes('y'), 'the words add theirs');
  assert.equal(new Set(out).size, out.length, 'each once');
});
