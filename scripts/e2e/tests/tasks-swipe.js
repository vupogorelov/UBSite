// @ts-check
// A phone's task list: a row swiped to the right is done; to the left it goes, with «Вернуть» for a few
// seconds — pressed, the task is back; not pressed, it is deleted on the server.
import { BASE } from '../lib.js';

/**
 * A finger's stroke across the screen (touch events through the browser's protocol).
 * @param {import('playwright-core').Page} page @param {{ x: number, y: number }} from @param {number} dx
 */
async function stroke(page, from, dx) {
  const cdp = await page.context().newCDPSession(page);
  const at = (/** @type {number} */ x) => [{ x, y: from.y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x + (dx * i) / 12) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export default {
  name: 'Задачи: смахнуть строку',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    await page.goto(BASE + '/tasks', { waitUntil: 'load' });
    const stamp = Date.now().toString(36);
    const [one, two] = [`Смахнуть вправо ${stamp}`, `Смахнуть влево ${stamp}`];
    const ids = await page.evaluate(async (/** @type {string[]} */ titles) => {
      const out = [];
      for (const title of titles) {
        const r = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
        out.push((await r.json()).id);
      }
      return out;
    }, [one, two]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
    /** @param {string} title */
    const middle = async (title) => {
      const b = await page.locator('.task-row', { hasText: title }).boundingBox();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    };

    const a = await middle(one);
    if (!a) return t.check('задачи появились в списке', false);
    await stroke(page, a, 140);
    await page.waitForTimeout(1200);
    const doneStatus = await page.evaluate(async (/** @type {number} */ id) => (await (await fetch('/api/tasks')).json()).tasks.find((/** @type {any} */ x) => x.id === id)?.status, ids[0]);
    t.check('вправо — задача готова', doneStatus === 'done', doneStatus);

    const b = await middle(two);
    if (!b) return t.check('вторая задача в списке', false);
    await stroke(page, b, -140);
    await page.waitForTimeout(500);
    const gone = (await page.locator('.task-row', { hasText: two }).count()) === 0;
    const toast = (await page.locator('.toast').textContent().catch(() => ''))?.replace(/\s+/g, ' ') ?? '';
    t.check('влево — строка ушла, «Вернуть» под рукой', gone && toast.includes('Вернуть'), toast);
    await page.locator('.toast button', { hasText: 'Вернуть' }).click();
    await page.waitForTimeout(500);
    t.check('«Вернуть» — задача снова в списке', (await page.locator('.task-row', { hasText: two }).count()) === 1);

    const c = await middle(two);
    if (c) await stroke(page, c, -140);
    await page.waitForTimeout(8000);
    const left = await page.evaluate(async (/** @type {number} */ id) => (await (await fetch('/api/tasks')).json()).tasks.some((/** @type {any} */ x) => x.id === id), ids[1]);
    t.check('не вернули — через несколько секунд удалена и на сервере', !left);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
