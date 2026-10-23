// @ts-check
// The phone's bottom bar tapped again: a section open — its button again leads back to the reading; reading —
// «Книга» again does nothing (the contents are ☰ in the header).
import { BASE, until } from '../lib.js';

export default {
  name: 'Нижняя панель: повторное нажатие',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    await page.goto(BASE + '/1', { waitUntil: 'load' });
    await page.locator('.reader-host:not(.behind) .pair').first().waitFor({ timeout: 20000 }).catch(() => {});
    const tap = (/** @type {string} */ label) => page.locator('.bottom-nav button', { hasText: label }).first().dispatchEvent('click');
    const reading = async () => /^\/\d/.test(new URL(page.url()).pathname) && (await page.locator('.app.toc-open').count()) === 0;
    const path = () => new URL(page.url()).pathname;

    await tap('Книга');
    await page.waitForTimeout(400); // (nothing should happen: a short look that nothing did)
    t.check('«Книга» при чтении — ничего не открывает', await reading(), path());

    for (const [label, at] of /** @type {[string, string][]} */ ([['Чат', '/chat'], ['Задачи', '/tasks']])) {
      await tap(label);
      await until(async () => path() === at, { timeout: 5000 });
      t.check(`«${label}» — открыт`, path() === at, path());
      await tap(label);
      await until(reading, { timeout: 5000 });
      t.check(`«${label}» ещё раз — снова чтение`, await reading(), path());
    }

    await tap('Заметки');
    await until(async () => (await page.locator('.app.toc-open').count()) === 1, { timeout: 5000 });
    t.check('«Заметки» — панель открыта', (await page.locator('.app.toc-open').count()) === 1);
    await tap('Заметки');
    await until(reading, { timeout: 5000 });
    t.check('«Заметки» ещё раз — снова чтение', await reading());
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
