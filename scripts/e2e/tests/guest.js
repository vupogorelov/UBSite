// @ts-check
// Public links: a quote's «Ссылка» gives an address anyone opens; a guest (not signed in) reads the
// paper with the quote lit, sees the numbers of discussions and variants, and is asked to sign in when
// reaching for them; the rest of the platform stays closed to them; the site itself still signs in.
import { BASE } from '../lib.js';

/** What the page copies or shares goes to window.__copied (no system share sheet in a test). */
const capture = () => {
  Object.defineProperty(navigator, 'share', { value: undefined });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (/** @type {string} */ s) => ((/** @type {any} */ (window)).__copied = s) } });
};

export default {
  name: 'Публичные ссылки и гость',
  /** @param {any} t */
  async run(t) {
    // a signed-in reader selects words and takes «Ссылка»
    const me = await t.page({ init: capture });
    await me.page.goto(BASE + '/1', { waitUntil: 'load' });
    await me.page.waitForTimeout(2000);
    const quote = await me.page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.querySelector('.pair .main-text'));
      const node = /** @type {Text} */ (el.firstChild);
      const r = document.createRange();
      r.setStart(node, 10);
      r.setEnd(node, 40);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      return { ref: el.dataset.ref, text: r.toString().trim() };
    });
    await me.page.waitForSelector('.sel-toolbar .tb-copy', { timeout: 5000 }).catch(() => {});
    await me.page.locator('.sel-toolbar .tb-copy').dispatchEvent('click');
    await me.page.waitForTimeout(300);
    const copied = /** @type {string} */ (await me.page.evaluate(() => (/** @type {any} */ (window)).__copied ?? ''));
    const link = copied.split('\n').at(-1) ?? '';
    t.check('«Ссылка»: цитата и адрес с её местом', copied.includes(quote.text) && link.includes(`/${quote.ref}?sel=ru.`), copied);
    // (a message in the paragraph's public discussion — on the test copy of the database)
    await me.page.evaluate(async (/** @type {string} */ ref) => {
      await fetch(`/api/public/thread/${ref}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Проверка: обсуждение абзаца' }) });
    }, quote.ref);

    // a guest opens it
    const g = await t.guest();
    await g.page.goto(link, { waitUntil: 'load' });
    await g.page.waitForTimeout(2000);
    t.check('гость: текст книги, а не вход', (await g.page.locator('.guest-app .pair').count()) > 0 && (await g.page.locator('.auth-page').count()) === 0);
    const lit = await g.page.evaluate(() => {
      const h = /** @type {any} */ (CSS).highlights?.get('shared-quote');
      return h ? [...h].map((/** @type {Range} */ r) => r.toString()).join('') : null;
    });
    t.check('гость: цитата из ссылки подсвечена', lit?.trim() === quote.text, lit);
    t.check('гость: шапка с «Войти»', (await g.page.locator('.guest-bar .guest-login').count()) === 1);

    // the numbers of discussions / variants, and the request to sign in
    const paper = await g.page.evaluate(async () => {
      for (let p = 1; p <= 196; p++) {
        const r = await (await fetch(`/api/guest/paper/${p}`)).json();
        if (Object.keys(r.messages).length || Object.keys(r.proposals).length) return p;
      }
      return null;
    });
    if (paper !== null) {
      await g.page.goto(`${BASE}/${paper}`, { waitUntil: 'load' });
      await g.page.waitForTimeout(2000);
      const marks = g.page.locator('.gutter-marks .gmark');
      t.check('гость: значки с числом обсуждений / вариантов', (await marks.count()) > 0, `текст ${paper}`);
      await marks.first().dispatchEvent('click');
      await g.page.waitForTimeout(300);
      t.check('гость: значок просит войти', (await g.page.locator('.guest-ask').count()) === 1);
      await g.page.locator('.guest-ask .ui-btn.primary').dispatchEvent('click');
      await g.page.waitForTimeout(300);
      t.check('«Войти» — вход с дорогой обратно к тексту', (await g.page.locator('.auth-page .auth-back').count()) === 1);
      await g.page.locator('.auth-back').dispatchEvent('click');
      await g.page.waitForTimeout(500);
      t.check('«Вернуться к тексту» — снова тот же текст', (await g.page.locator('.guest-app .pair').count()) > 0 && g.page.url().includes(`/${paper}`));
    } else t.check('(в базе нет обсуждений — значки не проверены)', true);

    // what stays closed, and the site itself
    const api = await g.page.evaluate(async () => {
      const s = async (/** @type {string} */ u) => (await fetch(u)).status;
      return { paper: await s('/api/papers/1'), notes: await s('/api/workspaces'), thread: await s('/api/public/thread/1:0.1'), search: await s('/api/search?q=бог') };
    });
    t.check('без входа открыт только текст: заметки, обсуждения, поиск — 401', api.paper === 200 && api.notes === 401 && api.thread === 401 && api.search === 401, api);
    await g.page.goto(BASE + '/', { waitUntil: 'load' });
    await g.page.waitForTimeout(800);
    t.check('сам сайт без входа — страница входа', (await g.page.locator('.auth-page').count()) === 1 && (await g.page.locator('.auth-back').count()) === 0);

    // the signed-in reader opens the same link: the quote is lit for them too
    await me.page.goto(link, { waitUntil: 'load' });
    await me.page.waitForTimeout(2000);
    const litMe = await me.page.evaluate(() => {
      const h = /** @type {any} */ (CSS).highlights?.get('shared-quote');
      return h ? [...h].map((/** @type {Range} */ r) => r.toString()).join('') : null;
    });
    t.check('вошедший по той же ссылке: цитата подсвечена', litMe?.trim() === quote.text, litMe);
    t.check('без ошибок на страницах', g.errors.length === 0 && me.errors.length === 0, [...g.errors, ...me.errors].slice(0, 2));
  },
};
