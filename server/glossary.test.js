// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createGlossary, findPhrase } from './glossary.js';
import { tokenize } from './search/text.js';

const stems = (/** @type {string} */ s) => tokenize(s).map((t) => t.stem);

test('phrases are found in any word form', () => {
  const tokens = tokenize('Задача Настройщика Мысли и настройщиком мысли');
  assert.equal(findPhrase(tokens, stems('Настройщик Мысли')).length, 2);
  assert.equal(findPhrase(tokens, stems('Мысли Настройщик')).length, 0);
});

test('glossary: checks, relevant terms and translation memory', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, username, username_key) VALUES (1, 'c', 'c')");
  const g = createGlossary(db);
  const id = g.create({ en: 'Thought Adjuster', ru: 'Настройщик Мысли', avoid: 'Регулятор Мысли\nНастройщик Мыслей' }, 1);
  assert.throws(() => g.create({ en: 'thought adjuster', ru: 'x' }, 1), /уже есть/);

  // a required term of the original disappeared; an undesirable variant appeared
  const w = g.check('дар Настройщика Мысли', 'дар Регулятора Мысли');
  assert.deepEqual(w.map((x) => x.kind).sort(), ['avoid', 'lost']);
  assert.equal(w[0].termId, id);
  assert.deepEqual(g.check('дар Настройщика Мысли', 'дар Настройщику Мысли'), []); // another form is fine
  // the old text already used the undesirable variant: replacing it is no news, keeping it is not flagged
  assert.deepEqual(g.check('Регулятор Мысли', 'Регулятор Мысли пребывает'), []);

  assert.equal(g.termsFor('просто слова', 'The Thought Adjuster indwells').length, 1); // by the English paragraph
  assert.equal(g.termsFor('Регулятора Мысли', 'nothing').length, 1); // by an undesirable variant
  assert.equal(g.termsFor('просто слова', 'nothing').length, 0);

  const add = (/** @type {string} */ original, /** @type {string} */ text, /** @type {string} */ status) => {
    const { id } = /** @type {{ id: number }} */ (
      db.prepare("INSERT INTO proposals (ref, start_pos, end_pos, original, author_id, status) VALUES ('5:1.1', 0, 1, ?, 1, ?) RETURNING id").get(original, status)
    );
    db.prepare('INSERT INTO proposal_versions (proposal_id, version, text) VALUES (?, 1, ?)').run(id, text);
    return id;
  };
  const voting = add('большая путаница', 'большая неразбериха', 'voting');
  const approved = add('Большой путанице', 'большой неразберихе', 'approved');
  const wider = add('существует большая путаница в понятиях', 'царит неразбериха в понятиях', 'approved');
  add('большая путаница', 'черновик', 'draft');
  assert.deepEqual(g.memory('большая путаница').map((h) => h.id), [approved, voting, wider]);
  assert.deepEqual(g.memory('большая путаница', approved).map((h) => h.id), [voting, wider]);
});
