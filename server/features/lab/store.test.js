// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../db.js';
import { createLab } from './store.js';

/** A model of its own: the meaning is which of three words a text has (a vector of three numbers). */
const fakeEngine = () => ({
  installed: () => true,
  running: () => false,
  stop() {},
  /** @param {string} _model @param {string} _kind @param {string[]} texts */
  async embed(_model, _kind, texts) {
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

    const lab = createLab(db, /** @type {any} */ (fakeEngine()), { file: join(dir, 'lab.db'), models: dir });
    lab.run('e5-base');
    for (let i = 0; i < 100 && lab.status().models[0].done < 6; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(lab.status().models[0].done, 6, 'both languages of the three paragraphs');

    const a = await lab.ask('что с детьми после смерти', () => [{ ref: '47:2.8' }, { ref: '47:2.9' }]);
    assert.deepEqual(a.columns.map((c) => c.id), ['e5-base', 'mix', 'words']);
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

    const kept = new DatabaseSync(join(dir, 'lab.db'), { readOnly: true });
    assert.deepEqual(kept.prepare("SELECT ref, good FROM judged WHERE question = 'дети'").all().map((r) => ({ ...r })), [{ ref: '47:2.7', good: 1 }], 'the old marks: only where the columns agreed');
    kept.close();
    lab.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
