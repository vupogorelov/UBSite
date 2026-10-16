// @ts-check
// The book without a network: the copy prepares itself after sign-in; offline, every book URL is answered
// from it byte for byte as the server answers; the app starts offline, signed in, and shows papers.
import { BASE, openControlled, waitCopy } from '../lib.js';

export default {
  name: 'Книга без сети',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, '/1');
    await waitCopy(page);
    t.check('копия книги сохранилась сама', true);

    const urls = (await page.evaluate(() => fetch('/api/offline/manifest').then((r) => r.json()))).files.map((/** @type {any} */ f) => f.url);
    const online = await page.evaluate(async (/** @type {string[]} */ us) => Promise.all(us.map((u) => fetch(u).then((r) => r.text()))), urls);
    await ctx.setOffline(true);
    const off = await page.evaluate(
      async (/** @type {string[]} */ us) => Promise.all(us.map(async (u) => { const r = await fetch(u); return [await r.text(), r.headers.get('x-offline')]; })),
      urls,
    );
    const same = off.filter((/** @type {[string, string | null]} */ [text, from], /** @type {number} */ i) => from === '1' && text === online[i]).length;
    t.check('без сети каждый ответ копии == ответ сервера', same === urls.length, `${same} из ${urls.length}`);

    await page.goto(`${BASE}/84`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const paras = await page.locator('[data-tts-key*=":"]').count();
    t.check('без сети Текст открывается, вход сохраняется', paras > 100 && (await page.locator('input[type="password"]').count()) === 0, `${paras} абзацев`);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
