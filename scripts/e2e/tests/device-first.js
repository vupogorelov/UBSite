// @ts-check
// The book's text from the device first: with the copy saved, a paper comes from it even online (no
// waiting for the network). The parts of the interface loaded later (tasks, «О приложении»…) are kept
// by the service worker at its install: never opened before, they open without a network.
import { BASE, openControlled, waitCopy } from '../lib.js';

export default {
  name: 'Книга с устройства, части интерфейса без сети',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, '/1');
    await waitCopy(page);
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      const res = await fetch('/api/papers/7');
      const body = await res.json();
      return { from: res.headers.get('x-offline'), ms: Math.round(performance.now() - t0), paper: body.paper?.id };
    });
    t.check('с сетью документ берётся с устройства (копия), не из сети', r.from === '1' && r.paper === 7, r);

    await ctx.setOffline(true);
    await page.goto(BASE + '/about', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    t.check('без сети: «О приложении» (не открывалось раньше) открывается', (await page.locator('.about-page').count()) === 1);
    await page.goto(BASE + '/tasks', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    t.check('без сети: «Задачи» (не открывались раньше) открываются', (await page.locator('.tasks-page, .task-add-btn, .tasks-empty').count()) > 0);
    await ctx.setOffline(false);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
