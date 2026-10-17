// @ts-check
// The dictionary of the book: a coordinator begins an article from the glossary's name, writes what it
// is and publishes it; the article shows its places in the text; «Что это?» on the selected name opens
// its card and leads to it; a guest reads it by a link (a draft not); it is in the book's copy.
import { BASE } from '../lib.js';

export default {
  name: 'Словарь книги',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.computer();
    // (the first person of the test database is an administrator: a coordinator's rights)
    await page.goto(BASE + '/d?q=Мелхиседек', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.locator('.dict-tabs .ui-chip', { hasText: 'Заготовки' }).click();
    await page.waitForTimeout(1500);
    const row = page.locator('.dict-candidates .set-row', { hasText: 'Мелхиседек' }).first();
    t.check('заготовки: имя из глоссария с числом абзацев', (await row.count()) === 1, (await row.textContent())?.replace(/\s+/g, ' ').trim());
    await row.locator('.dict-begin').click();
    await page.waitForURL(/\/d\/\d+/, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const id = Number(new URL(page.url()).pathname.split('/')[2]);
    t.check('статья начата и открыта для правки', (await page.locator('.art-edit').count()) === 1, page.url());
    const brief = 'Сын Божий, служивший на Урантии во времена Авраама.';
    await page.locator('.art-field', { hasText: 'Кратко — одно-два' }).locator('textarea').fill(brief);
    await page.locator('.art-edit .ui-btn.primary', { hasText: 'Сохранить' }).click();
    await page.waitForTimeout(800);
    await page.locator('.art-edit .ui-btn', { hasText: 'Опубликовать' }).click();
    await page.waitForTimeout(800);
    await page.locator('.art-edit .link-btn', { hasText: 'Готово' }).click();
    await page.waitForTimeout(500);
    const count = (await page.locator('.art-count').textContent())?.replace(/\s+/g, ' ').trim() ?? '';
    t.check('опубликована; в тексте книги — абзацы и первое упоминание', (await page.locator('.art-brief').textContent())?.trim() === brief && /\d+ абзац.* в \d+ Текст.*впервые/.test(count), count);

    // «Что это?» on the name in the text
    const first = (count.match(/впервые — (\S+)/) ?? [])[1];
    await page.goto(`${BASE}/${first}`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const picked = await page.evaluate((/** @type {string} */ ref) => {
      const el = /** @type {HTMLElement} */ (document.querySelector(`.main-text[data-ref="${ref}"]`));
      const text = el.textContent ?? '';
      const at = text.indexOf('Мелхиседек');
      if (at < 0) return null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let pos = 0, node, r = document.createRange();
      while ((node = walker.nextNode())) {
        const len = /** @type {Text} */ (node).length;
        if (at >= pos && at < pos + len) {
          r.setStart(node, at - pos);
          r.setEnd(node, Math.min(len, at - pos + 'Мелхиседек'.length));
          break;
        }
        pos += len;
      }
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return r.toString();
    }, first);
    await page.waitForTimeout(700);
    await page.locator('.sel-toolbar .tb-whatis').click();
    await page.waitForTimeout(1200);
    const card = (await page.locator('.whatis').textContent())?.replace(/\s+/g, ' ') ?? '';
    t.check('«Что это?» на имени в тексте — карточка статьи', !!picked && card.includes('Мелхиседек') && card.includes(brief), card.slice(0, 160));
    await page.locator('.whatis .ui-btn.primary').click();
    await page.waitForTimeout(1200);
    // (the article of the selected name — in a second run on the same database it may be the first run's)
    t.check('«Подробнее» — статья этого имени', /^\/d\/\d+$/.test(new URL(page.url()).pathname) && ((await page.locator('.art-name').textContent()) ?? '').includes('Мелхиседек'), page.url());

    // a guest by a link; a draft is not theirs
    const draftId = await page.evaluate(async () => (await (await fetch('/api/dict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nameRu: 'Черновая статья' }) })).json()).id);
    const g = await t.guest();
    await g.page.goto(`${BASE}/d/${id}`, { waitUntil: 'load' });
    await g.page.waitForTimeout(2500);
    t.check('гость по ссылке читает статью', (await g.page.locator('.guest-app .art-brief').textContent())?.trim() === brief);
    const draftStatus = await g.page.evaluate(async (/** @type {number} */ d) => (await fetch(`/api/dict/${d}`)).status, draftId);
    t.check('черновик гостю не виден', draftStatus === 404, draftStatus);

    // in the book's copy on the device
    const listed = await page.evaluate(async (/** @type {number} */ a) => {
      const m = await (await fetch('/api/offline/manifest')).json();
      return m.files.some((/** @type {{ url: string }} */ f) => f.url === `/api/dict/${a}`);
    }, id);
    t.check('опубликованная статья — в копии книги для чтения без сети', listed);
    t.check('без ошибок на страницах', errors.length === 0 && g.errors.length === 0, [...errors, ...g.errors].slice(0, 2));
  },
};
