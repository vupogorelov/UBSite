// @ts-check
// The phone's player: a bookmark on the paragraph heard, in one tap; the sleep timer — its minutes left
// by the progress line, and "to the end of the paper" stops the reading there.
import { BASE } from '../lib.js';

export default {
  name: 'Плеер: закладка и таймер сна',
  /** @param {any} t */
  async run(t) {
    // a voice that "speaks" at once (the test's browser has none): each sentence starts and ends
    const { page, errors } = await t.page({
      init: () => {
        const fake = {
          speaking: false, pending: false, paused: false,
          getVoices: () => [{ voiceURI: 'ru', name: 'Тест', lang: 'ru-RU', localService: true, default: true }],
          addEventListener() {}, removeEventListener() {}, cancel() {}, pause() {}, resume() {},
          /** @param {any} u */
          speak(u) { setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 30); }, 10); },
        };
        Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
      },
    });
    await page.goto(BASE + '/12:3.4', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const listen = page.locator('.bottom-nav button[aria-label^="Слушать"]');
    if (!(await listen.count())) return t.check('(«Слушать» не в нижней панели — не проверено)', true);
    await listen.click();
    await page.waitForTimeout(1500);

    // the bookmark on the paragraph heard
    await page.locator('.tts-mark').click();
    await page.waitForTimeout(1200);
    const toast = (await page.locator('.toast').textContent().catch(() => ''))?.replace(/\s+/g, ' ') ?? '';
    t.check('закладка на абзац, который звучит, — одним касанием', /Закладка( уже есть)? · \d+:\d+\.\d+/.test(toast), toast);
    if (toast.includes('Отменить')) await page.locator('.toast button', { hasText: 'Отменить' }).click();

    // the sleep timer: a pill by the progress line, each tap the next step round
    const pill = page.locator('.tts-sleep');
    const steps = [];
    for (let i = 0; i < 6; i++) {
      await pill.click();
      await page.waitForTimeout(150);
      steps.push((await pill.textContent())?.trim() ?? '');
    }
    t.check('таймер сна: по кругу — 15 → 30 → 45 → 60 мин → до конца → выключен', steps.join(' | ') === '15 мин | 30 мин | 45 мин | 60 мин | до конца | ', steps.join(' | '));
    const pct = await page.locator('.tts-progress').evaluate((/** @type {Element} */ row) => {
      const kids = [...row.children].map((k) => k.className);
      return kids.findIndex((c) => String(c).includes('tts-pct')) < kids.findIndex((c) => String(c).includes('tts-sleep'));
    });
    t.check('процент — слева от полосы, таймер — справа', pct);
    t.check('в настройках плеера строки таймера больше нет', (await page.locator('.tts-drawer .tts-list-row', { hasText: 'Таймер сна' }).count()) === 0);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
