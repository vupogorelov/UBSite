import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, pronounce, withStress, toPlus } from './pronounce.js';

test('stress marks: "+" before the vowel ⇄ U+0301 after it', () => {
  assert.equal(withStress('Небад+он'), 'Небадо́н');
  assert.equal(toPlus('Небадо́н'), 'Небад+он');
});

test('rules match word starts, keep endings and capitals; longer rules win', () => {
  const rules = compile([
    { written: 'небадон', spoken: withStress('небад+он') },
    { written: 'т. е.', spoken: 'то есть' },
    { written: 'Урант', spoken: 'Ур+ант' },
    { written: 'Урантия', spoken: 'Ура́нтия' },
  ]);
  assert.equal(pronounce('Небадона и небадону, т. е. вселенная', rules), 'Небадо́на и небадо́ну, то есть вселенная');
  assert.equal(pronounce('Урантия, урантийцы', rules), 'Ура́нтия, ур+антийцы');
  assert.equal(pronounce('Неурантийский', rules), 'Неурантийский'); // only at a word start
});
