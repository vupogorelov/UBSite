import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, inlineMd } from './markdown.js';

test('inline: bold, italic, code, links; HTML is escaped', () => {
  assert.equal(inlineMd('**жирный** и *курсив*, `a<b>`'), '<strong>жирный</strong> и <em>курсив</em>, <code>a&lt;b&gt;</code>');
  assert.equal(inlineMd('[сайт](https://x.org) [js](javascript:alert)'),
    '<a href="https://x.org" target="_blank" rel="noopener">сайт</a> <a href="#">js</a>');
  assert.equal(inlineMd('<script>'), '&lt;script&gt;');
  assert.equal(inlineMd('![Чтение](about/read.webp)', '/api/'), '<img src="/api/about/read.webp" alt="Чтение" loading="lazy">');
  assert.equal(inlineMd('![x](javascript:alert)'), '');
  assert.equal(renderMarkdown('**Роль**\\\nОписание\nдальше'), '<p><strong>Роль</strong><br>Описание дальше</p>');
  assert.equal(renderMarkdown('Текст\n\n![a](about/a.webp)', '/api/'), '<p>Текст</p>\n<p><img src="/api/about/a.webp" alt="a" loading="lazy"></p>');
});

test('blocks: headings, paragraphs, nested lists, quotes, code, tables, rules', () => {
  const html = renderMarkdown([
    '# Заголовок', '', 'Первая строка', 'вторая.', '',
    '- один', '  - вложенный', '- два', '', '1. первый', '2. второй', '',
    '> цитата', '', '```', 'x < 1', '```', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '---',
  ].join('\n'));
  assert.equal(html, [
    '<h1>Заголовок</h1>',
    '<p>Первая строка вторая.</p>',
    '<ul><li>один<ul><li>вложенный</li></ul></li><li>два</li></ul>',
    '<ol><li>первый</li><li>второй</li></ol>',
    '<blockquote><p>цитата</p></blockquote>',
    '<pre><code>x &lt; 1</code></pre>',
    '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    '<hr>',
  ].join('\n'));
});
