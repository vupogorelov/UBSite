// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBook, convertInline } from './parse-book.js';

const SAMPLE = `# Книга Урантии

### Часть I.  Центральная Вселенная и Сверхвселенные

Подготовлено Корпусом \\
\\
Вторая строка

<a id="x"></a>

\`\`\`
заметки выглядят тут так
\`\`\`

## Чст I - Центральная Вселенная и Сверхвселенные

### Текст 5 -- Связь Бога с индивидуумом

<a id="epub-text-8-p005s0-xhtml-langsections"></a>

---

**Раздел**

---

- [1\\. Приближение к Богу](#epub-text-8-p005s0-xhtml-p005s1)

**Текст 5 -- Связь Бога с индивидуумом**

<a id="epub-text-8-p005s0-xhtml-p005s0"></a>**Paper 5 -- God’s Relation to the Individual**

Если конечный ум *человека*\\!

***5:0.1 (62.1)*** <a id="epub-text-8-p005s0-xhtml-p005s0p1"></a>IF THE finite mind of man & <God>

**1\\. Приближение к Богу**

<a id="epub-text-8-p005s0-xhtml-p005s1"></a>**1. The Approach to God**

Неспособность \\[конечного\\]

***5:1.1 1155.4)*** <a id="a"></a>The inability

\\
\\* \\* \\*
`;

test('parses structure, pairs and headings', () => {
  const book = parseBook(SAMPLE);
  assert.deepEqual(book.parts, [
    { id: 1, titleRu: 'Центральная Вселенная и Сверхвселенные', titleEn: 'The Central and Superuniverses', subtitleRu: 'Подготовлено Корпусом\nВторая строка' },
  ]);
  assert.deepEqual(book.papers, [
    { id: 5, partId: 1, titleRu: 'Связь Бога с индивидуумом', titleEn: 'God’s Relation to the Individual' },
  ]);
  assert.deepEqual(book.sections, [
    { paperId: 5, num: 0, titleRu: null, titleEn: null },
    { paperId: 5, num: 1, titleRu: 'Приближение к Богу', titleEn: 'The Approach to God' },
  ]);
  const [p1, p2] = book.paragraphs;
  assert.equal(p1.ref, '5:0.1');
  assert.equal(p1.pageRef, '62.1');
  assert.equal(p1.htmlRu, 'Если конечный ум <i>человека</i>!');
  assert.equal(p1.plainRu, 'Если конечный ум человека!');
  assert.equal(p1.htmlEn, 'IF THE finite mind of man &amp; &lt;God&gt;');
  assert.equal(p2.ref, '5:1.1');
  assert.equal(p2.sectionNum, 1);
  assert.equal(p2.plainRu, 'Неспособность [конечного]');
  assert.deepEqual(book.issues.map((i) => i.level), ['info']); // the missing "("
});

test('reports a Russian line without English pair', () => {
  const book = parseBook(SAMPLE.replace('***5:0.1 (62.1)*** <a id="epub-text-8-p005s0-xhtml-p005s0p1"></a>IF THE finite mind of man & <God>\n', ''));
  assert.ok(book.issues.some((i) => i.level === 'error' && i.message.startsWith('Unpaired line')));
});

test('convertInline keeps textContent(html) equal to plain', () => {
  const { html, plain } = convertInline('a *b* \\*c\\* <d>');
  assert.equal(html.replace(/<\/?i>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), plain);
  assert.equal(plain, 'a b *c* <d>');
});
