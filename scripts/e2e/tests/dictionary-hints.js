// @ts-check
// The dictionary while reading (features/dictionary/hints.svelte.js): with «Подсказки словаря» on, the first
// place an article is named in a section is marked (a dot, or a line); the mouse over it shows the card on a
// computer, a tap opens the sheet on a phone. An article's discussion: its own chat, its count on the page.
import { BASE } from '../lib.js';

/** @param {import('playwright-core').Page} page @param {Record<string, unknown>} patch */
const setSettings = (page, patch) => page.evaluate(async (p) => {
  const ws = (await (await fetch('/api/workspaces')).json())[0].id;
  await fetch(`/api/workspaces/${ws}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
}, patch);

/** The first mark on the screen (below the header, above the bottom bar). @param {import('playwright-core').Page} page @param {string} sel */
const firstMark = (page, sel) => page.evaluate((s) => {
  const r = [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).find((b) => b.top > 70 && b.bottom < innerHeight - 160);
  return r ? { x: r.left + r.width / 2, y: r.top + r.height + 10 } : null;
}, sel);

export default {
  name: 'Подсказки словаря при чтении',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.computer();
    await page.goto(BASE + '/d', { waitUntil: 'load' });
    // «Урантия» published (an article of the test database's, or a new one)
    const id = await page.evaluate(async () => {
      const json = (/** @type {Response} */ r) => r.json();
      const send = (/** @type {string} */ u, /** @type {string} */ m, /** @type {unknown} */ b) => fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(json);
      const g = (await fetch('/api/glossary').then(json)).find((/** @type {any} */ x) => x.ru === 'Урантия');
      const had = (await fetch('/api/dict?drafts=1').then(json)).find((/** @type {any} */ a) => a.names.includes(g.id));
      const a = had ?? (await send('/api/dict', 'POST', { nameRu: 'Урантия', nameEn: 'Urantia', kind: 'place', glossaryIds: [g.id] }));
      await send(`/api/dict/${a.id}`, 'PATCH', { status: 'published', briefRu: a.briefRu || 'Наш мир.' });
      return a.id;
    });
    await setSettings(page, { dictHints: true, dictMark: 'dot' });

    await page.goto(BASE + '/93:2.1', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const dots = await page.locator('.dict-dot').count();
    t.check('отмечены первые упоминания в разделах (точки)', dots > 0, dots);
    const at = await firstMark(page, '.dict-dot');
    if (at) {
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(900);
      const card = (await page.locator('.dict-card').textContent().catch(() => ''))?.replace(/\s+/g, ' ') ?? '';
      t.check('мышь над отмеченным словом — карточка статьи', card.includes('Подробнее в словаре'), card.slice(0, 120));
      await page.locator('.dict-card-more').click();
      await page.waitForTimeout(1200);
      t.check('«Подробнее» — статья', /^\/d\/\d+$/.test(new URL(page.url()).pathname), page.url());
    } else t.check('(отмеченное слово не на экране — карточка не проверена)', true);

    await setSettings(page, { dictMark: 'line' });
    await page.goto(BASE + '/93:2.1', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    t.check('вид отметки «Тонкая линия»', (await page.locator('.dict-line').count()) > 0 && (await page.locator('.dict-dot').count()) === 0);

    // a phone: a tap opens the sheet (not the computer's card)
    const p = await t.page();
    await p.page.goto(BASE + '/93:2.1', { waitUntil: 'load' });
    await p.page.waitForTimeout(3500);
    const spot = await firstMark(p.page, '.dict-line');
    if (spot) {
      await p.page.touchscreen.tap(spot.x, spot.y - 14);
      await p.page.waitForTimeout(900);
      t.check('касание отмеченного слова на телефоне — шторка статьи', (await p.page.locator('.whatis').count()) === 1 && (await p.page.locator('.dict-card').count()) === 0);
    } else t.check('(отмеченное слово не на экране телефона — касание не проверено)', true);

    // the discussion
    await page.goto(`${BASE}/d/${id}`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate(async (/** @type {number} */ a) => fetch(`/api/chat/c/${encodeURIComponent(`dict:${a}`)}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Вопрос к статье' }) }), id);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const discuss = (await page.locator('.art-discuss').textContent())?.replace(/\s+/g, ' ') ?? '';
    t.check('у статьи — обсуждение с числом сообщений', /\d+ сообщени/.test(discuss), discuss);
    await page.locator('.art-discuss').click();
    await page.waitForTimeout(1800);
    const head = (await page.locator('.tg-chat-head').textContent())?.replace(/\s+/g, ' ') ?? '';
    t.check('обсуждение открывается в чате, с путём к статье', page.url().includes(encodeURIComponent(`dict:${id}`)) && head.includes('Открыть статью') && (await page.locator('.tg-row', { hasText: 'Вопрос к статье' }).count()) > 0, head.slice(0, 100));

    await setSettings(page, { dictHints: false, dictMark: 'dot' });
    t.check('без ошибок на страницах', errors.length === 0 && p.errors.length === 0, [...errors, ...p.errors].slice(0, 2));
  },
};
