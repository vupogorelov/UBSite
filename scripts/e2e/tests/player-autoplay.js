// @ts-check
// «Читать сразу при открытии» (the player's settings): «Слушать» opens the player and it begins reading by
// itself 2 s later; closed before that — it does not; off — it waits for ▶. The app's fake engine
// (app-bridge.js) counts what it is given to read.
import { openControlled, until } from '../lib.js';
import { fakeApp } from './app-bridge.js';

export default {
  name: 'Плеер: читать сразу при открытии',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page({ init: fakeApp, arg: 400 });
    await openControlled(page, '/1');
    await page.locator('.reader-host:not(.behind) .pair').first().waitFor({ timeout: 20000 }).catch(() => {});
    const listen = () => page.locator('.bottom-nav button', { hasText: 'Слушать' }).first().dispatchEvent('click');
    const spoken = () => page.evaluate(() => /** @type {any} */ (window).__calls.filter((/** @type {any[]} */ c) => c[0] === 'speak').length);
    const reading = () => page.locator('.tts-play[aria-label="Остановить"]').count();
    const autoSwitch = page.locator('.tts-auto input');

    // the switch in the player's settings (the copy's person may have it on: it is put back at the end)
    await listen();
    await page.locator('.tts-controls button[aria-label="Настройки голоса"]').dispatchEvent('click');
    await autoSwitch.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const was = await autoSwitch.isChecked();
    if (was) {
      // (on: the player opened just now is reading by itself already — stopped, closed, the switch off, opened again)
      await autoSwitch.dispatchEvent('click');
      await until(async () => !(await autoSwitch.isChecked()), { timeout: 3000 });
      await listen();
      await until(async () => (await page.locator('.tts-panel').count()) === 0, { timeout: 3000 });
      await page.evaluate(() => (/** @type {any} */ (window).__calls.length = 0));
      await listen();
      await page.locator('.tts-controls button[aria-label="Настройки голоса"]').dispatchEvent('click');
      await autoSwitch.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    }
    t.check('в настройках плеера — «Читать сразу», выключено', (await autoSwitch.count()) === 1 && !(await autoSwitch.isChecked()));

    // its ⓘ: a tap shows how it works (the switch beside it untouched), a tap again hides it
    const info = page.locator('.tts-auto .info-tip');
    const tip = page.locator('.tts-auto .info-tip-text');
    await info.tap();
    await until(async () => await tip.isVisible(), { timeout: 3000 });
    const words = ((await tip.textContent()) ?? '').trim();
    t.check('ⓘ — подсказка, как это работает; переключатель не тронут', (await tip.isVisible()) && words.startsWith('Плеер начнёт читать сам') && !(await autoSwitch.isChecked()), words);
    await info.tap();
    await until(async () => !(await tip.isVisible()), { timeout: 3000 });
    t.check('ⓘ ещё раз — подсказка закрыта', !(await tip.isVisible()));
    await page.waitForTimeout(2600); // (off: nothing begins by itself)
    t.check('выключено — плеер ждёт ▶', (await spoken()) === 0 && (await reading()) === 0, await spoken());
    await autoSwitch.dispatchEvent('click');
    await until(async () => await autoSwitch.isChecked(), { timeout: 3000 });
    await listen(); // (closed)
    await until(async () => (await page.locator('.tts-panel').count()) === 0, { timeout: 3000 });

    // on: opened — reading 2 s later, from the text on screen
    await listen();
    await page.waitForTimeout(800);
    t.check('включено — через мгновение ещё не читает (ждёт 2 с, кольцо у ▶)', (await spoken()) === 0 && (await page.locator('.tts-play.auto').count()) === 1);
    await until(async () => (await spoken()) > 0, { timeout: 5000 });
    t.check('включено — через 2 с читает сам', (await spoken()) > 0 && (await reading()) === 1, await spoken());
    await listen(); // (stops and closes)
    await until(async () => (await page.locator('.tts-panel').count()) === 0, { timeout: 3000 });

    // on, ▶ within the 2 s — the wait and the reading cancelled, the player stays
    const atPlay = await spoken();
    await listen();
    await page.waitForTimeout(500);
    await page.locator('.tts-play').dispatchEvent('click');
    await page.waitForTimeout(2600);
    t.check('▶ во время отсчёта — отмена: не читает, кольца нет, плеер открыт', (await spoken()) === atPlay && (await reading()) === 0
      && (await page.locator('.tts-play.auto').count()) === 0 && (await page.locator('.tts-panel').count()) === 1);
    await listen(); // (closed)
    await until(async () => (await page.locator('.tts-panel').count()) === 0, { timeout: 3000 });

    // on, but closed within the 2 s — nothing read
    const before = await spoken();
    await listen();
    await page.waitForTimeout(500);
    await listen();
    await page.waitForTimeout(2600);
    t.check('закрыт раньше 2 с — не начинает', (await spoken()) === before && (await page.locator('.tts-panel').count()) === 0);

    // put back as it was
    await listen();
    await page.locator('.tts-controls button[aria-label="Настройки голоса"]').dispatchEvent('click');
    if ((await autoSwitch.isChecked()) !== was) await autoSwitch.dispatchEvent('click');
    await page.waitForTimeout(800); // (the setting's save waits 400 ms)
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
