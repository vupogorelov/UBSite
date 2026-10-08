// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBody } from './markup.js';

test('comment markup: bold, italic, refs, tags, escaping', () => {
  assert.equal(
    renderBody('Ср. с 2:5.10. **важно** и *тонко* #тема/подтема <script>'),
    'Ср. с <a href="/2:5.10" data-internal>2:5.10</a>. <b>важно</b> и <i>тонко</i> ' +
      '<span class="tag">#тема/подтема</span> &lt;script&gt;',
  );
  assert.equal(renderBody('Текст 5:1 и 1934:12.1 и 12:30'), 'Текст <a href="/5:1" data-internal>5:1</a> и 1934:12.1 и <a href="/12:30" data-internal>12:30</a>');
  assert.equal(renderBody('a\nb'), 'a<br>b');
  assert.equal(renderBody('2 * 3 * 4'), '2 * 3 * 4');
});
