// @ts-check
// The devices' journal: a failure on the page and the Android app's own crash reach the administrator's
// journal within seconds, with the buttons pressed before and the device; a search's text never does.
import { BASE, openControlled } from '../lib.js';

/** The app (android/) with a crash written down last time. */
function fakeApp() {
  const w = /** @type {any} */ (window);
  w.UBNative = {
    version: () => 3,
    appVersion: () => '1.4',
    takeLog: () => JSON.stringify([{ at: new Date(Date.now() - 60000).toISOString(), level: 'error', name: 'Приложение упало: java.lang.IllegalStateException: проверка', data: { thread: 'main' } }]),
    voices: () => '[]', speak: () => {}, cancel: () => {}, player: () => {}, meta: () => {}, end: () => {}, bars: () => {},
    server: () => '', setServer: () => {},
  };
}

export default {
  name: 'Журнал событий',
  /** @param {any} t */
  async run(t) {
    const { page } = await t.page({ init: fakeApp });
    await openControlled(page, '/1');
    await page.waitForTimeout(1500);
    const secret = `тайный-запрос-${Date.now().toString(36)}`;
    await page.locator('.bottom-nav').getByText('Ещё').click();
    await page.waitForTimeout(300);
    await page.locator('.more-row', { hasText: 'Поиск' }).click();
    await page.waitForTimeout(300);
    await page.locator('input[aria-label="Поисковый запрос"]').fill(secret);
    await page.locator('input[aria-label="Поисковый запрос"]').press('Enter');
    await page.waitForTimeout(800);
    await page.evaluate(() => setTimeout(() => { throw new Error('Проверка журнала'); }));
    await page.waitForTimeout(4000); // (a failure is sent within 2 s)

    const log = await page.evaluate(() => fetch('/api/admin/log', { cache: 'no-store' }).then((r) => r.json()));
    const s = log.sessions?.find((/** @type {any} */ x) => x.events.some((/** @type {any} */ e) => e.kind === 'error' && e.name.includes('Проверка журнала')));
    t.check('сбой на странице — в журнале за секунды', !!s, s ? `${s.events.length} событий` : log);
    if (!s) return;
    const names = s.events.map((/** @type {any} */ e) => `${e.kind}:${e.name}`);
    t.check('событие самого приложения (Android) — там же', names.some((/** @type {string} */ n) => n.startsWith('android:Приложение упало')));
    const taps = names.filter((/** @type {string} */ n) => n.startsWith('tap:'));
    t.check('нажатия перед сбоем — понятными названиями', taps.includes('tap:Ещё') && taps.includes('tap:Поиск') && taps.includes('tap:Найти'), taps);
    t.check('устройство и версия приложения', /телефон · приложение 1\.4/.test(s.device), s.device);
    t.check('текста поискового запроса в журнале нет', !JSON.stringify(log).includes(secret));

    await page.goto(`${BASE}/1`, { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.locator('.bottom-nav').getByText('Ещё').click();
    await page.waitForTimeout(300);
    await page.locator('.more-row', { hasText: 'Администрирование' }).click();
    await page.waitForTimeout(500);
    await page.locator('.set-row', { hasText: 'Журнал' }).click();
    await page.waitForTimeout(1200);
    t.check('экран «Журнал» открывается, последний сбой раскрыт', (await page.locator('.log-session.failed .log-events').count()) >= 1);
    await page.screenshot({ path: `${process.env.LOCALAPPDATA}/ubsite-e2e/journal-${t.kind}.png` }).catch(() => {});
  },
};
