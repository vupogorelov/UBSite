// @ts-check
// «Что нового»: the newest entry not seen is in the bell (counted); opened — the page with the entries;
// seen, it leaves the bell (also after a reload: the setting is the person's); «О приложении» leads to it.
import { BASE } from '../lib.js';

export default {
  name: 'Что нового',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    // (as if never seen)
    await page.goto(BASE + '/api/auth/me');
    await page.evaluate(async () => {
      const ws = (await (await fetch('/api/workspaces')).json())[0].id;
      await fetch(`/api/workspaces/${ws}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whatsNewSeen: '' }) });
    });
    await page.goto(BASE + '/1', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const bell = page.locator('button[aria-label^="Уведомления"]').first();
    t.check('колокольчик считает «Что нового»', /новых/.test((await bell.getAttribute('aria-label')) ?? ''), await bell.getAttribute('aria-label'));
    await bell.click();
    await page.waitForTimeout(800);
    const card = page.locator('.notif-new');
    const text = (await card.textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim() ?? '';
    t.check('первым пунктом — «Что нового · дата» с первыми строками', /^Что нового · \d+ \S+ \d{4}/.test(text), text.slice(0, 120));
    await card.click();
    await page.waitForTimeout(1500);
    t.check('открылась страница с записями по датам', new URL(page.url()).pathname === '/whatsnew' && (await page.locator('.wn-entry h2').count()) > 0);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.locator('button[aria-label^="Уведомления"]').first().click();
    await page.waitForTimeout(800);
    t.check('просмотрено — в колокольчике его больше нет (и после перезагрузки)', (await page.locator('.notif-new').count()) === 0);
    await page.goto(BASE + '/about', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    t.check('«О приложении» ведёт к «Что нового»', (await page.locator('a.about-news[href="/whatsnew"]').count()) === 1);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
