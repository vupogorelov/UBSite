// @ts-check
// The narrator's recording without a network: Settings → «Память» — a paper downloaded by
// choice, then played from the device without a network (whole and in parts: seeking); a part's
// download paused and cancelled with what it had saved removed; a paper removed.
import { openControlled } from '../lib.js';

export default {
  name: 'Записи диктора без сети',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, '/1');
    await page.waitForTimeout(1500);
    await page.locator('.bottom-nav').getByText('Ещё').click();
    await page.waitForTimeout(300);
    await page.locator('.more-row', { hasText: 'Настройки' }).dispatchEvent('click');
    await page.waitForTimeout(500);
    await page.locator('.set-row', { hasText: 'Память' }).dispatchEvent('click');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.LOCALAPPDATA}/ubsite-e2e/device-open-${t.kind}.png` }).catch(() => {});
    if (!(await page.locator('.dev-part').count())) console.log('    (screen:', (await page.locator('.settings-drawer').textContent())?.replace(/\s+/g, ' ').slice(0, 300), ')');
    const part1 = page.locator('.dev-part').first();
    await part1.locator('.dev-open').dispatchEvent('click');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.LOCALAPPDATA}/ubsite-e2e/device-${t.kind}.png`, fullPage: false }).catch(() => {});

    // Текст 1: downloaded by choice
    const paper1 = page.locator('.dev-paper', { hasText: 'Текст 1' }).first();
    const size = (await paper1.locator('.ui-btn').textContent())?.trim();
    await paper1.locator('.ui-btn').dispatchEvent('click');
    await page.waitForFunction(() => !document.querySelector('.dev-job'), null, { timeout: 120000 }).catch(() => {});
    t.check('Текст 1 скачан по выбору — размер был виден заранее', (await paper1.getByText('Удалить').count()) === 1, size);

    // played from the device without a network: whole, and a part (seeking)
    const files = await page.evaluate(async () => (await (await caches.open('ub-audio')).keys()).map((r) => new URL(r.url).pathname));
    await ctx.setOffline(true);
    const got = await page.evaluate(async (/** @type {string} */ p) => {
      const whole = await fetch(p);
      const part = await fetch(p, { headers: { Range: 'bytes=100-199' } });
      return { whole: whole.status, size: (await whole.blob()).size, part: part.status, range: part.headers.get('content-range'), partSize: (await part.blob()).size };
    }, files[0]);
    t.check('без сети: файл звучит с устройства, и перемотка (часть файла) тоже', got.whole === 200 && got.part === 206 && got.partSize === 100, got);
    await ctx.setOffline(false);

    // a part: paused, then cancelled with what it saved removed
    const before = files.length;
    await part1.locator('.ui-btn').dispatchEvent('click');
    await page.waitForTimeout(2500);
    await page.locator('.dev-job').getByText('Пауза').dispatchEvent('click');
    await page.waitForTimeout(300);
    t.check('пауза', (await page.locator('.dev-job').getByText('Продолжить').count()) === 1);
    const cancelAll = page.locator('.dev-job').getByText('Отменить и удалить скачанное');
    if (await cancelAll.count()) await cancelAll.dispatchEvent('click');
    else await page.locator('.dev-job').getByText('Отменить').dispatchEvent('click');
    await page.waitForTimeout(800);
    const after = await page.evaluate(async () => (await (await caches.open('ub-audio')).keys()).length);
    t.check('отмена: скачанное этой загрузкой убрано, прежнее осталось', (await page.locator('.dev-job').count()) === 0 && after === before, { before, after });

    await paper1.getByText('Удалить').dispatchEvent('click');
    await page.waitForTimeout(800);
    t.check('«Удалить»: Текст 1 убран с устройства', (await page.evaluate(async () => (await (await caches.open('ub-audio')).keys()).length)) === 0);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
