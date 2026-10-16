// @ts-check
// Tasks without a network: a task, a subtask made and ticked before it was sent; after a reload still
// there; back online — on the server once, the subtask done; another device of the person gets the
// task through the feed.
import { openControlled } from '../lib.js';

export default {
  name: 'Задачи без сети',
  /** @param {any} t */
  async run(t) {
    const a = await t.page();
    const b = await t.page();
    await openControlled(a.page, '/tasks');
    await openControlled(b.page, '/tasks');
    await a.page.waitForTimeout(2000);
    const title = `Задача без сети ${t.kind} ${Date.now().toString(36)}`;
    const sub = 'Шаг первый';

    await a.ctx.setOffline(true);
    await a.page.locator('.task-add-btn').click();
    await a.page.locator('input[aria-label="Новая задача"]').fill(title);
    await a.page.locator('input[aria-label="Новая задача"]').press('Enter');
    await a.page.waitForTimeout(500);
    t.check('без сети: задача сразу в списке', (await a.page.getByText(title).count()) > 0);
    await a.page.getByText(title).first().click();
    await a.page.waitForTimeout(500);
    await a.page.locator('input[aria-label="Новая подзадача"]').fill(sub);
    await a.page.locator('input[aria-label="Новая подзадача"]').press('Enter');
    await a.page.waitForTimeout(500);
    await a.page.locator('.drawer input[aria-label="Готово"]').first().check();
    await a.page.waitForTimeout(500);
    t.check('без сети: подзадача отмечена', await a.page.locator('.drawer input[aria-label="Готово"]').first().isChecked());

    await a.page.reload({ waitUntil: 'load' }).catch(() => {});
    await a.page.waitForTimeout(2500);
    await a.page.getByText(title).first().click();
    await a.page.waitForTimeout(500);
    t.check('после перезагрузки: задача и отмеченная подзадача на месте',
      (await a.page.locator('.drawer').getByText(title).count()) + (await a.page.locator('.drawer input[aria-label="Подзадача"]').count()) >= 1 &&
        (await a.page.locator('.drawer input[aria-label="Готово"]').first().isChecked().catch(() => false)));
    await a.page.keyboard.press('Escape');

    await a.ctx.setOffline(false);
    await a.page.waitForTimeout(5000);
    const onServer = await a.page.evaluate(async (/** @type {string} */ ti) => {
      const r = await fetch('/api/tasks', { cache: 'no-store' }).then((x) => x.json());
      return r.tasks.filter((/** @type {any} */ x) => x.title === ti).map((/** @type {any} */ x) => ({ uid: x.uid, subtasks: x.subtasks }));
    }, title);
    t.check('связь вернулась: на сервере одна задача со своим uid, подзадача выполнена',
      onServer.length === 1 && !!onServer[0].uid && onServer[0].subtasks.length === 1 && onServer[0].subtasks[0].done === true, onServer);

    await b.page.evaluate(() => dispatchEvent(new Event('online')));
    await b.page.waitForTimeout(1500);
    t.check('другое устройство: задача пришла через ленту, без перезагрузки', (await b.page.getByText(title).count()) > 0);
    t.check('без ошибок на страницах', a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 2));
  },
};
