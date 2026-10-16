// @ts-check
// Search without a network, through the app's own search panel: the word index is prepared in the
// background while there is a network; offline, the counts equal the server's.
import { openControlled, waitCopy } from '../lib.js';

const QUERIES = ['Бог', 'Настройщик Мысли', 'бог ~3 любовь', '/Бог[аеу]/i', 'язык:en God', 'часть:4 Иисус', 'бог -отец', 'всеобщ*'];

export default {
  name: 'Поиск без сети',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, '/1');
    await waitCopy(page);
    await page.waitForFunction(() => {
      const m = JSON.parse(localStorage.getItem('ub.offline') ?? 'null');
      return m?.search && localStorage.getItem('ub.offlineSearch') === m.search;
    }, null, { timeout: 120000 });
    t.check('указатель поиска подготовлен в фоне', true);

    const online = await page.evaluate(async (/** @type {string[]} */ qs) => {
      const ws = localStorage.getItem('ub.workspace') ?? '1';
      return Promise.all(qs.map((q) => fetch(`/api/search?ws=${ws}&q=${encodeURIComponent(q)}&offset=0&limit=50`).then((r) => r.json()).then((d) => d.total)));
    }, QUERIES);

    await ctx.setOffline(true);
    await page.locator('.bottom-nav').getByText('Ещё').click();
    await page.waitForTimeout(400);
    await page.locator('.more-row', { hasText: 'Поиск' }).click();
    await page.waitForTimeout(400);
    const input = page.locator('input[aria-label="Поисковый запрос"]');
    for (const [i, q] of QUERIES.entries()) {
      await input.fill(q);
      await input.press('Enter');
      const ms = await page.evaluate(async (/** @type {number} */ want) => {
        const t0 = performance.now();
        while (performance.now() - t0 < 20000) {
          const m = (document.querySelector('.search-panel')?.textContent ?? '').match(/([\d\s]+)\sабзац/);
          if (m && Number(m[1].replace(/\D/g, '')) === want) return Math.round(performance.now() - t0);
          await new Promise((r) => setTimeout(r, 25));
        }
        return -1;
      }, online[i]);
      t.check(`«${q}» без сети = сервер (${online[i]})`, ms >= 0, ms >= 0 ? `${ms} мс` : 'не дождались');
    }
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
