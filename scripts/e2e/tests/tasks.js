// @ts-check
// Tasks without a network: two tasks, the second dragged into the first — its subtask — and ticked in the
// card, all before anything was sent; after a reload still there; back online — on the server once, the
// subtask done, the second task gone; another device of the person gets the task through the feed.
import { openControlled, until } from '../lib.js';

export default {
  name: 'Задачи без сети',
  /** @param {any} t */
  async run(t) {
    const a = await t.page();
    const b = await t.page();
    await openControlled(a.page, '/tasks');
    await openControlled(b.page, '/tasks');
    await a.page.waitForTimeout(2000);
    const stamp = `${t.kind} ${Date.now().toString(36)}`;
    const title = `Задача без сети ${stamp}`;
    const sub = `Шаг первый ${stamp}`;
    /** A new task, at the top of the list. @param {string} text */
    const add = async (text) => {
      // (after a task is added its field stays open for the next one)
      if (!(await a.page.locator('input[aria-label="Новая задача"]').count())) await a.page.locator('.task-add-btn').click();
      await a.page.locator('input[aria-label="Новая задача"]').fill(text);
      await a.page.locator('input[aria-label="Новая задача"]').press('Enter');
      await until(async () => (await a.page.getByText(text).count()) > 0, { timeout: 5000 });
    };
    const row = (/** @type {string} */ text) => a.page.locator('.task-list .task-row', { has: a.page.locator('.task-title', { hasText: text }) });

    await a.ctx.setOffline(true);
    await add(title);
    t.check('без сети: задача сразу в списке', (await a.page.getByText(title).count()) > 0);
    await add(sub);
    // the second dragged onto the first's middle (a mouse: press, move, release — lib/taskdrag.js)
    const from = await row(sub).boundingBox();
    const to = await row(title).boundingBox();
    if (from && to) {
      await a.page.mouse.move(from.x + from.width / 2, from.y + from.height * 0.6);
      await a.page.mouse.down();
      for (let i = 1; i <= 10; i++) await a.page.mouse.move(from.x + from.width / 2, from.y + from.height * 0.6 + ((to.y + to.height / 2) - (from.y + from.height * 0.6)) * (i / 10));
      await a.page.mouse.up();
    }
    const tick = () => row(title).locator('.task-sub input[type="checkbox"]').first();
    await until(async () => (await tick().count()) === 1, { timeout: 5000 });
    t.check('без сети: перетащенная задача — подзадача первой, второй задачи больше нет', (await tick().count()) === 1 && (await row(sub).count()) === 0);
    await tick().check();
    await until(async () => await tick().isChecked(), { timeout: 3000 });
    t.check('без сети: подзадача отмечена в карточке', await tick().isChecked());

    await a.page.reload({ waitUntil: 'load' }).catch(() => {});
    await until(async () => (await tick().count()) === 1, { timeout: 10000 });
    t.check('после перезагрузки: задача и отмеченная подзадача на месте', (await tick().isChecked().catch(() => false)) === true);

    await a.ctx.setOffline(false);
    /** @returns {Promise<{ uid: string, title: string, subtasks: { title: string, done: boolean }[] }[]>} */
    const server = () => a.page.evaluate(async () => (await fetch('/api/tasks', { cache: 'no-store' }).then((x) => x.json())).tasks);
    await until(async () => (await server()).some((x) => x.title === title && x.subtasks.length === 1 && x.subtasks[0].done), { timeout: 15000, every: 500 });
    const all = await server();
    const onServer = all.filter((x) => x.title === title);
    t.check('связь вернулась: на сервере одна задача со своим uid, подзадача выполнена, второй задачи нет',
      onServer.length === 1 && !!onServer[0].uid && onServer[0].subtasks.length === 1 && onServer[0].subtasks[0].done === true && !all.some((x) => x.title === sub), onServer);

    await b.page.evaluate(() => dispatchEvent(new Event('online')));
    await b.page.waitForTimeout(1500);
    t.check('другое устройство: задача пришла через ленту, без перезагрузки', (await b.page.getByText(title).count()) > 0);
    t.check('без ошибок на страницах', a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 2));
  },
};
