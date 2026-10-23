// @ts-check
// Every update in one bell card «Обновление»: only what is new — read it (seen, it goes, on every device);
// a newer build of the site — «Перезапустить»; a newer Android app — «Установить 1.6». «О приложении»
// leads to «Что нового» and, in the app, reinstalls it.
import { BASE, until } from '../lib.js';

/** @param {import('playwright-core').Page} page */
const unsee = (page) => page.evaluate(async () => {
  const ws = (await (await fetch('/api/workspaces')).json())[0].id;
  await fetch(`/api/workspaces/${ws}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whatsNewSeen: '' }) });
});
/** The page is up: the book's text and the bell. @param {import('playwright-core').Page} page */
const ready = (page) => page.locator('.reader-host:not(.behind) .pair').first().waitFor({ timeout: 20000 }).catch(() => {});
/** The bell's card as text now ('' — none). @param {import('playwright-core').Page} page */
const cardText = async (page) => ((await page.locator('.notif-new').textContent({ timeout: 500 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
/**
 * The bell's card, as text: the bell opened (once), then its card waited for while `want` (if given) does
 * not hold yet — not a fixed time. @param {import('playwright-core').Page} page @param {(s: string) => boolean} [want]
 */
async function card(page, want) {
  const bell = page.locator('button[aria-label^="Уведомления"]').first();
  if ((await bell.getAttribute('aria-expanded')) !== 'true') await bell.click();
  // (the menu drawn: its card, or its list, or "Пока ничего")
  await until(async () => (await page.locator('.notif-new, .ui-empty, .notif-pad, .notif-list, .ui-card').count()) > 0, { timeout: 4000 });
  if (want) await until(async () => want(await cardText(page)), { timeout: 8000 });
  return cardText(page);
}

export default {
  name: 'Обновление и «Что нового»',
  /** @param {any} t */
  async run(t) {
    // 1. only what is new
    const a = await t.page();
    await a.page.goto(BASE + '/api/auth/me');
    await unsee(a.page);
    await a.page.goto(BASE + '/1', { waitUntil: 'load' });
    await ready(a.page);
    const bell = a.page.locator('button[aria-label^="Уведомления"]').first();
    await until(async () => /новых/.test((await bell.getAttribute('aria-label')) ?? ''), { timeout: 8000 });
    t.check('колокольчик считает обновление', /новых/.test((await bell.getAttribute('aria-label')) ?? ''), await bell.getAttribute('aria-label'));
    const news = await card(a.page, (s) => s.startsWith('Что нового'));
    t.check('карточка «Что нового · дата» с первыми строками, без кнопки действия', /^Что нового · \d+ \S+ \d{4}/.test(news) && (await a.page.locator('.notif-new .ui-chip').count()) === 0, news.slice(0, 120));
    await a.page.locator('.notif-new-more').click();
    await a.page.locator('.wn-entry h2').first().waitFor({ timeout: 8000 }).catch(() => {});
    t.check('«Что нового ›» — страница с записями по датам', new URL(a.page.url()).pathname === '/whatsnew' && (await a.page.locator('.wn-entry h2').count()) > 0);
    // (seen: the setting has to reach the server before the reload — its save waits 400 ms)
    await a.page.waitForTimeout(1000);
    await a.page.reload({ waitUntil: 'load' });
    // (the entries on the page: the bell knows them too — the same store)
    await a.page.locator('.wn-entry h2').first().waitFor({ timeout: 15000 }).catch(() => {});
    t.check('прочитано — карточки больше нет (и после перезагрузки)', (await card(a.page)) === '');
    await a.page.goto(BASE + '/about', { waitUntil: 'load' });
    await a.page.locator('a.about-news').first().waitFor({ timeout: 10000 }).catch(() => {});
    t.check('«О приложении» ведёт к «Что нового»', (await a.page.locator('a.about-news[href="/whatsnew"]').count()) === 1);

    // 2. a newer build of the site
    const b = await t.page();
    await b.page.route('**/version.json', (/** @type {any} */ r) => (new URL(r.request().url()).pathname === '/version.json' ? r.fulfill({ json: { build: 'newer' } }) : r.fallback()));
    await b.page.goto(BASE + '/1', { waitUntil: 'load' });
    await ready(b.page);
    await b.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // (the bell's check, now)
    const site = await card(b.page, (s) => s.startsWith('Обновление'));
    t.check('новая сборка сайта — «Обновление» с «Перезапустить»', site.startsWith('Обновление') && site.includes('Перезапустить'), site.slice(0, 120));

    // 3. a newer Android app (a stand-in for the app: version 1.5; the site serves 1.6)
    const c = await t.page({
      init: () => {
        /** @type {any} */ (window).UBNative = {
          version: () => 2, appVersion: () => '1.5', voices: () => '[]', speak() {}, cancel() {}, player() {}, meta() {}, end() {},
          bars() {}, server: () => location.origin, setServer() {},
        };
      },
    });
    await c.page.route('**/app/version.json', (/** @type {any} */ r) => r.fulfill({ json: { code: 8, name: '1.6' } }));
    await c.page.goto(BASE + '/1', { waitUntil: 'load' });
    await ready(c.page);
    await c.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const app = await card(c.page, (s) => s.includes('Установить 1.6'));
    t.check('новый APK — «Обновление приложения · 1.5 → 1.6» с «Установить 1.6»', app.includes('Обновление приложения · 1.5 → 1.6') && app.includes('Установить 1.6'), app.slice(0, 140));
    await c.page.goto(BASE + '/about', { waitUntil: 'load' });
    await until(async () => ((await c.page.locator('.about-app').textContent({ timeout: 500 }).catch(() => '')) ?? '').includes('1.5'), { timeout: 10000 });
    const about = (await c.page.locator('.about-app').textContent().catch(() => ''))?.replace(/\s+/g, ' ') ?? '';
    t.check('в «О приложении» — версия и «Переустановить»', about.includes('1.5') && about.includes('Переустановить'), about);
    await c.page.locator('.bottom-nav button', { hasText: 'Ещё' }).click();
    await c.page.locator('.more-row').first().waitFor({ timeout: 5000 }).catch(() => {});
    t.check('в «Ещё» строки «Переустановить» больше нет', (await c.page.locator('.more-row', { hasText: 'Переустановить' }).count()) === 0);
    t.check('без ошибок на страницах', [...a.errors, ...b.errors, ...c.errors].length === 0, [...a.errors, ...b.errors, ...c.errors].slice(0, 2));
  },
};
