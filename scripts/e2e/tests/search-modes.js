// @ts-check
// The search's three ways above its field: by the words, by meaning, the hybrid one. The copy has no model's
// vectors (data/lab.db is not copied): by meaning, the search says so and shows the words' results; the way
// chosen is kept.
import { openControlled } from '../lib.js';

export default {
  name: 'Поиск: по словам, по смыслу, гибридный',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    await openControlled(page, '/1');
    await page.locator('.bottom-nav').getByText('Ещё').click();
    await page.waitForTimeout(400);
    await page.locator('.more-row', { hasText: 'Поиск' }).click();
    await page.waitForTimeout(400);
    const modes = page.locator('.search-modes [role="radio"]');
    t.check('три способа над полем', (await modes.allTextContents()).join('|') === 'По словам|По смыслу|Гибридный');
    // (the copy's person may have chosen another way: it is put back at the end; the default for a new
    // person — by the words — is the settings' unit test)
    const was = await modes.evaluateAll((/** @type {Element[]} */ els) => els.findIndex((e) => e.getAttribute('aria-checked') === 'true'));
    await modes.nth(0).click();
    t.check('выбор «По словам» отмечен', (await modes.nth(0).getAttribute('aria-checked')) === 'true');

    const input = page.locator('input[aria-label="Поисковый запрос"]');
    await input.fill('Бог');
    await input.press('Enter');
    const summary = page.locator('.search-panel .search-summary');
    await summary.waitFor();
    const words = (await summary.textContent())?.trim();

    await modes.nth(1).click();
    await page.locator('.search-panel .search-note').waitFor({ timeout: 15000 });
    const note = (await page.locator('.search-panel .search-note').textContent())?.trim() ?? '';
    t.check('без модели: сказано, и показан поиск по словам', /поиск по словам/.test(note), note);
    t.check('те же результаты, что по словам', (await summary.textContent())?.trim() === words, words);
    t.check('выбор «По смыслу» отмечен', (await modes.nth(1).getAttribute('aria-checked')) === 'true');
    t.check('подсказка в поле — вопрос своими словами', (await input.getAttribute('placeholder'))?.startsWith('Вопрос') ?? false);

    await page.waitForTimeout(1000); // (the settings reach the server 400 ms after a change)
    await page.reload();
    await page.locator('.bottom-nav').getByText('Ещё').click();
    await page.waitForTimeout(400);
    await page.locator('.more-row', { hasText: 'Поиск' }).click();
    await page.waitForTimeout(400);
    t.check('выбор сохранён', (await page.locator('.search-modes [role="radio"]').nth(1).getAttribute('aria-checked')) === 'true');
    await page.locator('.search-modes [role="radio"]').nth(Math.max(0, was)).click(); // (back as it was: the next browser's user is the same)
    await page.waitForTimeout(1000);
    t.check('без ошибок на странице', errors.filter((/** @type {string} */ e) => !/503/.test(e)).length === 0, errors.slice(0, 2));
  },
};
