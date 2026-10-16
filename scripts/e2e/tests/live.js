// @ts-check
// Live changes: what is made on one device shows on another in a moment — told by the server over the
// live stream (server/live.js), not found by a poll a minute later. Nothing is nudged here: no reload,
// no "online", no focus.
import { BASE } from '../lib.js';

export default {
  name: 'Живые изменения между устройствами',
  /** @param {any} t */
  async run(t) {
    const a = await t.page();
    const b = await t.page();
    await b.page.goto(BASE + '/tasks', { waitUntil: 'load' });
    await a.page.goto(BASE + '/1', { waitUntil: 'load' });
    await b.page.waitForTimeout(2500); // (the stream open)

    const title = `Живая задача ${Date.now()}`;
    await a.page.evaluate(async (/** @type {string} */ ti) => {
      await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: ti }) });
    }, title);
    const t0 = Date.now();
    const seen = await b.page.getByText(title).first().waitFor({ timeout: 8000 }).then(() => Date.now() - t0, () => null);
    t.check('задача с одного устройства — на другом за секунды, без перезагрузки', seen !== null && seen < 5000, seen === null ? 'не пришла' : `${seen} мс`);

    // a bookmark on a paragraph: the other device's book marks it
    await b.page.goto(BASE + '/1', { waitUntil: 'load' });
    await b.page.waitForTimeout(2500);
    // (a paragraph with no bookmark yet: the two browsers share one test database)
    const ref = await b.page.evaluate(() => /** @type {HTMLElement} */ ([...document.querySelectorAll('.pair')].slice(2).find((p) => !p.querySelector('.gmark-bookmark'))).id.slice(2));
    const before = await b.page.locator(`#p-${ref.replace(/[:.]/g, '\\$&')} .gmark-bookmark`).count();
    await a.page.evaluate(async (/** @type {string} */ r) => {
      const ws = (await (await fetch('/api/workspaces')).json()).find((/** @type {any} */ w) => w.kind === 'personal').id;
      await fetch(`/api/workspaces/${ws}/annotations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: r, bookmark: true }) });
    }, ref);
    const t1 = Date.now();
    const marked = await b.page.locator(`#p-${ref.replace(/[:.]/g, '\\$&')} .gmark-bookmark`).first().waitFor({ timeout: 8000 }).then(() => Date.now() - t1, () => null);
    t.check('закладка с одного устройства — отмечена в книге на другом', before === 0 && marked !== null && marked < 5000, marked === null ? `не пришла (было ${before})` : `${marked} мс`);
    t.check('без ошибок на страницах', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 2));
  },
};
