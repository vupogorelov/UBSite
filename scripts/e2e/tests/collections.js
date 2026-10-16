// @ts-check
// Collections without a network: every collection of the workspace is kept in the background, so one
// never opened on this device reads offline; changing one needs the network and says so.
import { BASE, openControlled } from '../lib.js';

export default {
  name: 'Подборки без сети',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, '/1');
    // a collection made on the server now (as from another device), never opened here
    const made = await page.evaluate(async () => {
      const ws = localStorage.getItem('ub.workspace') ?? '1';
      const c = await fetch(`/api/workspaces/${ws}/collections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Подборка без сети ${Date.now().toString(36)}` }) }).then((r) => r.json());
      await fetch(`/api/collections/${c.id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', body: 'Мысль в подборке' }) });
      return c;
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(12000); // (kept quietly ~8 s after opening)
    await ctx.setOffline(true);
    await page.goto(`${BASE}/c/${made.id}`, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(2500);
    t.check('без сети: ни разу не открытая подборка читается', (await page.getByText('Мысль в подборке').count()) > 0, made.title);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
