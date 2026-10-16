// @ts-check
// Notes without a network, through the paragraph's menu as a person does it: a bookmark, a tag on that
// very new bookmark (it is not on the server yet — addressed by its own id from the device), a comment;
// all on screen at once and after a reload; back online — on the server once each, the tag on its note.
import { BASE, openControlled, waitCopy } from '../lib.js';

export default {
  name: 'Заметки без сети',
  /** @param {any} t */
  async run(t) {
    const { ctx, page, errors } = await t.page();
    await openControlled(page, '/1');
    await waitCopy(page);
    // two paragraphs of paper 1 without notes on this copy
    const free = await page.evaluate(async () => {
      const ws = localStorage.getItem('ub.workspace') ?? '1';
      const taken = new Set((await fetch(`/api/workspaces/${ws}/annotations?paper=1`).then((r) => r.json())).map((/** @type {any} */ n) => n.ref));
      return [...document.querySelectorAll('[data-tts-key*=":"]')].map((e) => /** @type {HTMLElement} */ (e).dataset.ttsKey ?? '').filter((r) => !taken.has(r)).slice(3, 5);
    });
    const [bmRef, cmRef] = free;
    const menu = async (/** @type {string} */ ref) => {
      await page.locator(`button[aria-label="Действия с абзацем ${ref}"]`).first().dispatchEvent('click');
      await page.waitForTimeout(500);
    };
    const tag = `офлайн-${t.kind}`;
    const text = `Мысль без сети ${t.kind} ${Date.now().toString(36)}`;

    await ctx.setOffline(true);
    await menu(bmRef);
    await page.locator('.tb-bookmark').dispatchEvent('click');
    await page.waitForTimeout(500);
    t.check('без сети: закладка сразу', (await page.locator('.tb-bookmark.on').count()) === 1);
    await page.locator('.tb-tags').dispatchEvent('click');
    await page.waitForTimeout(300);
    const tagInput = page.locator('.sel-toolbar input:not(.sel-title)').first();
    await tagInput.fill(tag);
    await tagInput.press('Enter');
    await page.waitForTimeout(500);
    t.check('без сети: метка на новую закладку', ((await page.locator('.tb-tags').textContent()) ?? '').includes('1'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await menu(cmRef);
    await page.locator('.tb-comment').dispatchEvent('click');
    await page.waitForTimeout(700);
    await page.locator('textarea').last().fill(text);
    await page.locator('button[aria-label="Отправить"]').last().dispatchEvent('click');
    await page.waitForTimeout(800);
    t.check('без сети: комментарий сразу, с часиками', (await page.getByText(text).count()) > 0 && (await page.locator('.tg-wait').count()) > 0);
    await page.screenshot({ path: `${process.env.LOCALAPPDATA}/ubsite-e2e/notes-offline-${t.kind}.png` }).catch(() => {});

    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(2500);
    await menu(bmRef);
    t.check('после перезагрузки без сети: закладка с меткой на месте', (await page.locator('.tb-bookmark.on').count()) === 1 && ((await page.locator('.tb-tags').textContent()) ?? '').includes('1'));
    await page.keyboard.press('Escape');

    await ctx.setOffline(false);
    await page.waitForTimeout(5000);
    const onServer = await page.evaluate(async (/** @type {string[]} */ refs) => {
      const ws = localStorage.getItem('ub.workspace') ?? '1';
      const list = await fetch(`/api/workspaces/${ws}/annotations?paper=1`, { cache: 'no-store' }).then((r) => r.json());
      return refs.map((ref) => list.filter((/** @type {any} */ n) => n.ref === ref).map((/** @type {any} */ n) => ({ uid: n.uid, bookmark: n.bookmark, tags: n.tags, comments: n.comments.map((/** @type {any} */ c) => c.body) })));
    }, [bmRef, cmRef]);
    const [bm, cm] = onServer;
    t.check('связь вернулась: закладка на сервере одна, с меткой, со своим uid', bm.length === 1 && bm[0].bookmark && bm[0].tags.includes(tag) && !!bm[0].uid, bm);
    t.check('комментарий на сервере один', cm.length === 1 && cm[0].comments.length === 1 && cm[0].comments[0] === text, cm);
    t.check('часиков не осталось', (await page.locator('.tg-wait').count()) === 0);
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
    void BASE;
  },
};
