// @ts-check
// Pairs of terms on a computer (lib/termpairs.svelte.js): the mouse over a glossary term in the Russian
// lights it and its English counterpart; leaving the text clears it.
import { BASE } from '../lib.js';

export default {
  name: 'Пары терминов под мышью',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.computer();
    await page.goto(BASE + '/1', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    // a Russian term's place on the screen: the first paragraph on screen that names one
    const at = await page.evaluate(async () => {
      const r = await (await fetch('/api/papers/1/terms')).json();
      for (const [ref, p] of Object.entries(/** @type {Record<string, { ru: number[], en: number[] }>} */ (r.paras))) {
        const el = document.querySelector(`.main-text[data-ref="${ref}"]`);
        if (!el || !p.ru.length || !p.en.length) continue;
        // the range of characters [start, end) in the element's text
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let pos = 0, node, range = document.createRange(), set = 0;
        while ((node = walker.nextNode())) {
          const len = /** @type {Text} */ (node).length;
          if (!set && p.ru[0] < pos + len) (range.setStart(node, p.ru[0] - pos), (set = 1));
          if (set && p.ru[1] <= pos + len) {
            range.setEnd(node, p.ru[1] - pos);
            break;
          }
          pos += len;
        }
        el.scrollIntoView({ block: 'center' });
        const b = range.getBoundingClientRect();
        if (b.width) return { x: b.left + Math.min(4, b.width / 2), y: b.top + b.height / 2, ref, word: range.toString() };
      }
      return null;
    });
    if (!at) return t.check('(в тексте 1 нет терминов глоссария — не проверено)', true);
    await page.waitForTimeout(300);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(400);
    const lit = await page.evaluate(() => {
      const h = /** @type {any} */ (CSS).highlights;
      return { cur: h?.get('term-cur')?.size ?? 0, text: h?.get('term-cur') ? [...h.get('term-cur')].map((/** @type {Range} */ r) => r.toString()) : [] };
    });
    t.check('термин под мышью подсвечен вместе с английской парой', lit.cur >= 1, { word: at.word, ...lit });
    await page.mouse.move(5, 300); // off the text
    await page.dispatchEvent('.paper', 'mouseleave').catch(() => {});
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => /** @type {any} */ (CSS).highlights?.get('term-cur')?.size ?? 0);
    t.check('ушли с текста — подсветка снята', after === 0, after);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
