// @ts-check
// «Поддержать проект» — a feature in a folder of its own (web/src/features/support/, server/features/support.js):
// its page opens with its own styles; the security policy lets the widget's site in, as the feature asked.
import { BASE } from '../lib.js';

export default {
  name: 'Функция в своей папке: «Поддержать проект»',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    const res = await page.goto(BASE + '/support', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const csp = (await res?.allHeaders())?.['content-security-policy'] ?? '';
    t.check('политика безопасности пускает виджет ЮMoney (по просьбе функции)', /frame-src 'self' https:\/\/yoomoney\.ru;/.test(csp), csp.match(/frame-src[^;]*/)?.[0]);
    const w = await page.evaluate(() => {
      const f = document.querySelector('.support-widget iframe');
      return f ? { src: f.getAttribute('src'), maxWidth: getComputedStyle(f).maxWidth, height: getComputedStyle(f).height } : null;
    });
    t.check('страница открыта, виджет на месте — со стилями из своего компонента', !!w && /yoomoney\.ru/.test(w.src ?? '') && w.maxWidth === '500px' && w.height === '480px', w);
    t.check('заголовок страницы из реестра', (await page.locator('.m-section-title, .section-title, h1').filter({ hasText: 'Поддержать проект' }).count()) > 0);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
