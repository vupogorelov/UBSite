// @ts-check
// A phone's bottom bar held: «Книга» — a bookmark on the paragraph at the top of the screen (with
// «Отменить»); «Слушать» — a note to it opens (a comment's draft).
import { BASE } from '../lib.js';

/** A finger held on an element for a while (touch events through the browser's protocol). @param {import('playwright-core').Page} page @param {string} selector */
async function hold(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`not on screen: ${selector}`);
  const cdp = await page.context().newCDPSession(page);
  const at = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at });
  await page.waitForTimeout(750);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export default {
  name: 'Нижняя панель: долгое касание',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    await page.goto(BASE + '/12:3.4', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const before = await page.evaluate(async () => (await (await fetch('/api/workspaces')).json())[0].id);
    const notesOf = () => page.evaluate(async (/** @type {number} */ ws) => (await (await fetch(`/api/workspaces/${ws}/annotations?paper=12`)).json()), before);
    await hold(page, '.bottom-nav button[aria-label^="Книга"]');
    await page.waitForTimeout(1500);
    const toast = (await page.locator('.toast').textContent().catch(() => ''))?.replace(/\s+/g, ' ') ?? '';
    const marked = (await notesOf()).find((/** @type {any} */ n) => n.lang === null && n.bookmark);
    t.check('«Книга» удержана — закладка на абзац на экране, с «Отменить»', !!marked && toast.includes('Закладка') && toast.includes('Отменить'), { toast, ref: marked?.ref });
    const opened = await page.evaluate(() => [...document.querySelectorAll('.toc-pane, .sheet, .drawer')].some((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'));
    t.check('…и оглавление вместо этого не открылось', !opened);
    await page.locator('.toast button', { hasText: 'Отменить' }).click();
    await page.waitForTimeout(1500);
    const still = (await notesOf()).find((/** @type {any} */ n) => n.ref === marked?.ref && n.lang === null && n.bookmark);
    t.check('«Отменить» — закладки нет', !still);

    const listen = '.bottom-nav button[aria-label^="Слушать"]';
    if (await page.locator(listen).count()) {
      await hold(page, listen);
      await page.waitForTimeout(1200);
      t.check('«Слушать» удержана — открыта заметка к абзацу, плеер не включился',
        (await page.locator('textarea').count()) > 0 && (await page.locator('.tts-panel, .mini-player').count()) === 0);
    } else t.check('(«Слушать» не в нижней панели — не проверено)', true);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
