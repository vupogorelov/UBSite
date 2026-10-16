// @ts-check
// The feed of changes: two devices of one person. A note made on one shows on the other without a
// reload (the feed brings it); the other keeps the workspace's notes whole — offline, a paper never
// opened there shows its note too; the lists of notes show it.
import { BASE, openControlled } from '../lib.js';

export default {
  name: 'Лента изменений: два устройства',
  /** @param {any} t */
  async run(t) {
    const a = await t.page();
    const b = await t.page();
    await openControlled(a.page, '/1');
    await openControlled(b.page, '/1');
    await a.page.waitForTimeout(2000);
    await b.page.waitForTimeout(2000);

    /** A paragraph of a paper without notes. @param {any} page @param {number} paper */
    const freeRef = (page, paper) =>
      page.evaluate(async (/** @type {number} */ p) => {
        const ws = localStorage.getItem('ub.workspace') ?? '1';
        const taken = new Set((await fetch(`/api/workspaces/${ws}/annotations?paper=${p}`).then((r) => r.json())).map((/** @type {any} */ n) => n.ref));
        for (let i = 2; i < 30; i++) for (const s of [1, 2]) if (!taken.has(`${p}:${s}.${i}`)) return `${p}:${s}.${i}`;
        return null;
      }, paper);
    const bookmark = async (/** @type {any} */ page, /** @type {string} */ ref) => {
      await page.locator(`button[aria-label="Действия с абзацем ${ref}"]`).first().dispatchEvent('click');
      await page.waitForTimeout(400);
      await page.locator('.tb-bookmark').dispatchEvent('click');
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
    };
    const isBookmarked = async (/** @type {any} */ page, /** @type {string} */ ref) => {
      await page.locator(`button[aria-label="Действия с абзацем ${ref}"]`).first().dispatchEvent('click');
      await page.waitForTimeout(400);
      const on = (await page.locator('.tb-bookmark.on').count()) === 1;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      return on;
    };

    // A: a bookmark in paper 1 — B, open on paper 1, sees it once the feed is asked (no reload)
    const r1 = /** @type {string} */ (await freeRef(a.page, 1));
    await bookmark(a.page, r1);
    await b.page.evaluate(() => dispatchEvent(new Event('online'))); // (as when the network is back; otherwise within a minute)
    await b.page.waitForTimeout(1500);
    t.check('заметка с другого устройства — без перезагрузки', await isBookmarked(b.page, r1), r1);

    // A: a bookmark in paper 2, never opened on B; B gets it, goes offline, opens paper 2
    const r2 = /** @type {string} */ (await freeRef(a.page, 2));
    await a.page.goto(`${BASE}/2`, { waitUntil: 'load' });
    await a.page.waitForTimeout(1500);
    await bookmark(a.page, r2);
    await b.page.evaluate(() => dispatchEvent(new Event('online')));
    await b.page.waitForTimeout(1500);
    await b.ctx.setOffline(true);
    await b.page.goto(`${BASE}/2`, { waitUntil: 'load' }).catch(() => {});
    await b.page.waitForTimeout(2500);
    t.check('без сети: заметка в ни разу не открытом Тексте — на месте', await isBookmarked(b.page, r2), r2);

    // the lists of notes: the book's notes (bookmarks) — offline, from the kept feed
    await b.page.locator('.bottom-nav').getByText('Заметки').click();
    await b.page.waitForTimeout(1200);
    const listed = await b.page.evaluate((/** @type {string[]} */ refs) => refs.map((r) => (document.body.textContent ?? '').includes(r)), [r1, r2]);
    t.check('без сети: обе заметки в списке заметок', listed.every(Boolean), listed);
    t.check('без ошибок на страницах', a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 2));
  },
};
