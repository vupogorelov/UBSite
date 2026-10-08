import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRu, inline } from './parse-ru.js';

test('inline markup: italics, superscript, entities; plain = textContent', () => {
  const r = inline('&#160;&#160;Масса *солнца* (2 х 10<sup>27</sup>) &amp; «так»');
  assert.equal(r.html, 'Масса <i>солнца</i> (2 х 10<sup>27</sup>) &amp; «так»');
  assert.equal(r.plain, 'Масса солнца (2 х 1027) & «так»');
});

test('paragraphs, decor lines, paper and section titles', () => {
  const md = [
    '## <a name="U5_0_0"></a>Связь Бога с индивидуумом',
    '### <a name="U5_1_0"></a>1&#8228;&#160;Приближение к Богу',
    '<a name="U5_1_1"></a>*5:1.1 (62.3)* Неспособность *конечного* создания.',
    '<a name="U5_1_2"></a>&#160;&#160;&#160;&#160;* * *',
    '### <a name="U139_10_0"></a>9 и 10&#8228;&#160;Иаков и Иуда Алфеевы',
  ].join('\n');
  const r = parseRu(md);
  assert.equal(r.papers.get(5), 'Связь Бога с индивидуумом');
  assert.equal(r.titles.get('5:1'), 'Приближение к Богу');
  assert.equal(r.titles.get('139:10'), '9 и 10. Иаков и Иуда Алфеевы');
  const s = r.sections.get('5:1') ?? [];
  assert.deepEqual(s.map((e) => [e.anchor, e.label, e.page]), [['5:1.1', '5:1.1', '62.3'], ['5:1.2', null, null]]);
  assert.equal(s[0].html, 'Неспособность <i>конечного</i> создания.');
  assert.equal(r.issues.length, 0);
});
