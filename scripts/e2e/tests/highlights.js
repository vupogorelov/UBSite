// @ts-check
// Highlights in Chrome 114 (the WebView of some phones): it does not resolve var() inside ::highlight(),
// and loses a shorthand with var() entirely — the site rewrites those rules with plain colours. Here every
// rule that uses var() must have its resolved twin; in the current Chrome nothing needs rewriting.

export default {
  name: 'Подсветка в старом Chrome',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page();
    await page.goto(`http://localhost:${process.env.E2E_PORT ?? 4399}/1`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      /** @type {string[]} */
      const withVar = [];
      for (const s of document.styleSheets) {
        let rules;
        try {
          rules = s.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes('::highlight(') || /** @type {Element | null} */ (s.ownerNode)?.id === 'hl-resolved') continue;
          // a declaration lost by the browser (a shorthand with var()) shows as an empty longhand
          if (rule.style.cssText.includes('var(') || /: ;/.test(rule.style.cssText)) withVar.push(rule.selectorText);
        }
      }
      const resolved = document.getElementById('hl-resolved')?.textContent ?? '';
      return { withVar, missing: withVar.filter((sel) => !resolved.includes(sel)), lost: [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).filter((x) => x instanceof CSSStyleRule && x.selectorText.includes('::highlight(') && /: ;/.test(x.style.cssText)).map((x) => /** @type {CSSStyleRule} */ (x).selectorText) };
    });
    if (t.kind === 'chromium114') {
      t.check('каждое правило подсветки с var() переписано готовыми цветами', r.missing.length === 0, r.missing);
      t.check('ни одно правило не потеряно (сокращение с var())', r.lost.length === 0, r.lost);
    } else t.check('современный Chrome — переписывать не нужно', true);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
