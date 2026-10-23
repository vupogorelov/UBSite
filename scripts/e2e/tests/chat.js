// @ts-check
// The one queue of changes, in a chat: online as before; offline the messages show at once with a clock,
// survive a reload and go by themselves when the network is back (once each, in order); an answer lost on
// the way does not double a message; a refusal stays with "!" and «Удалить» takes it away.
// E2E_SLOW=1: also waits 65 s offline — the message keeps the time it was written.
import { openControlled, until } from '../lib.js';

const KEY = process.env.E2E_CHAT ?? 'chan:1';

export default {
  name: 'Очередь изменений: чат',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, `/chat?c=${encodeURIComponent(KEY)}`);
    await page.locator('textarea').last().waitFor({ timeout: 15000 }).catch(() => {});
    const stamp = `${t.kind}-${Date.now().toString(36)}`;
    const say = async (/** @type {string} */ text) => {
      await page.locator('textarea').last().fill(text);
      await page.locator('button[aria-label="Отправить"]').dispatchEvent('click');
      await page.waitForTimeout(400);
    };
    /** @returns {Promise<{ id: number, body: string, writtenAt: string | null, createdAt: string }[]>} */
    const server = () =>
      page.evaluate(async (/** @type {string} */ k) => {
        const r = await fetch(`/api/chat/c/${encodeURIComponent(k)}/messages`, { cache: 'no-store' });
        return r.ok ? r.json() : [];
      }, KEY);
    const count = (/** @type {any[]} */ list, /** @type {string} */ body) => list.filter((m) => m.body === body).length;
    const clocks = () => page.locator('.tg-wait').count();

    t.check('чат открыт по ссылке во весь экран, поле ввода видно', (await page.locator('.bottom-nav').count()) === 0 || !(await page.locator('.bottom-nav').isVisible()));

    await say(`онлайн ${stamp}`);
    await until(async () => count(await server(), `онлайн ${stamp}`) >= 1 && (await clocks()) === 0, { timeout: 5000 });
    t.check('с сетью — уходит сразу, один раз', count(await server(), `онлайн ${stamp}`) === 1 && (await clocks()) === 0);

    await ctx.setOffline(true);
    await say(`офлайн-1 ${stamp}`);
    await say(`офлайн-2 ${stamp}`);
    t.check('без сети — сразу на экране, с часиками', (await clocks()) === 2);
    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await until(async () => (await clocks()) === 2, { timeout: 8000 });
    t.check('часики переживают перезагрузку', (await clocks()) === 2);

    if (process.env.E2E_SLOW) await page.waitForTimeout(65000);
    await ctx.setOffline(false);
    // (the queue sent and empty: both on the server, no clock left)
    await until(async () => (await clocks()) === 0 && count(await server(), `офлайн-2 ${stamp}`) >= 1, { timeout: 12000 });
    const s = await server();
    const i1 = s.findIndex((m) => m.body === `офлайн-1 ${stamp}`);
    const i2 = s.findIndex((m) => m.body === `офлайн-2 ${stamp}`);
    t.check('связь вернулась — ушли сами, по одному разу, по порядку', count(s, `офлайн-1 ${stamp}`) === 1 && count(s, `офлайн-2 ${stamp}`) === 1 && i2 > i1 && (await clocks()) === 0);
    if (process.env.E2E_SLOW) t.check('время написания сохранилось', !!s[i1]?.writtenAt, s[i1]);

    // a reaction without a network: on the message at once, on the server once the network is back
    const online = s.find((m) => m.body === `онлайн ${stamp}`);
    await ctx.setOffline(true);
    await page.locator(`#msg-${online?.id} .tg-bubble`).dispatchEvent('contextmenu');
    await page.waitForTimeout(300);
    const emoji = (await page.locator('.tg-menu-reactions button').first().textContent())?.trim() ?? '';
    await page.locator('.tg-menu-reactions button').first().dispatchEvent('click');
    await page.waitForTimeout(400);
    t.check('без сети: реакция сразу на сообщении', (await page.locator(`#msg-${online?.id} .tg-reaction.mine`).count()) === 1, emoji);
    await ctx.setOffline(false);
    const reactions = () => page.evaluate(async (/** @type {any} */ a) => {
      const r = await fetch(`/api/chat/c/${encodeURIComponent(a.k)}/messages`, { cache: 'no-store' }).then((x) => x.json());
      return r.find((/** @type {any} */ m) => m.id === a.id)?.reactions ?? [];
    }, { k: KEY, id: online?.id });
    await until(async () => (await reactions()).some((/** @type {any} */ r) => r.emoji === emoji && r.mine), { timeout: 12000 });
    const reacted = await reactions();
    t.check('связь вернулась: реакция на сервере', reacted.some((/** @type {any} */ r) => r.emoji === emoji && r.mine), reacted);

    let n = 0;
    await page.route('**/api/chat/c/*/messages', async (/** @type {any} */ route) => {
      if (route.request().method() !== 'POST' || n++ > 0) return route.continue();
      await route.fetch(); // (the server does it)
      await route.abort('connectionreset'); // (its answer never arrives)
    });
    await say(`обрыв ${stamp}`);
    // (sent again after the lost answer and the queue empty — nothing more will go)
    await until(async () => (await clocks()) === 0 && count(await server(), `обрыв ${stamp}`) >= 1, { timeout: 15000 });
    t.check('ответ потерялся — на сервере всё равно одно сообщение', count(await server(), `обрыв ${stamp}`) === 1 && (await clocks()) === 0);

    await page.unroute('**/api/chat/c/*/messages');
    await page.route('**/api/chat/c/*/messages', (/** @type {any} */ route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Писать в этот чат нельзя' }) })
        : route.continue(),
    );
    await say(`отказ ${stamp}`);
    await until(async () => (await page.locator('.tg-failed').count()) === 1, { timeout: 8000 });
    const line = await page.locator('.tg-failed-row span').first().textContent().catch(() => null);
    t.check('отказ — «!» и причина', (await page.locator('.tg-failed').count()) === 1 && !!line?.includes('Писать в этот чат нельзя'), line);
    await page.locator('.tg-failed-row button', { hasText: 'Удалить' }).dispatchEvent('click');
    await page.waitForTimeout(500);
    t.check('«Удалить» убирает непринятое', (await page.locator('.tg-failed').count()) === 0);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
