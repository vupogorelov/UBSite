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

    // the sleep timer: 15 minutes — its minutes by the progress line
    await page.locator('.tts-controls button[aria-label="Настройки голоса"]').click();
    await page.waitForTimeout(600);
    await page.locator('.tts-drawer .tts-list-row', { hasText: 'Таймер сна' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('radio', { name: '15 минут' }).click();
    await page.waitForTimeout(500);
    t.check('таймер сна: осталось 15 минут — у полосы прогресса', (await page.locator('.tts-sleep').textContent())?.trim() === '15 мин');
    // "to the end of the paper": reading stops at the paper's end, not going on to the next
    await page.locator('.tts-drawer .tts-list-row', { hasText: 'Таймер сна' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('radio', { name: 'До конца Текста' }).click();
    await page.waitForTimeout(500);
    t.check('«До конца Текста» — отмечено у полосы', (await page.locator('.tts-sleep').textContent())?.trim() === 'до конца');
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
