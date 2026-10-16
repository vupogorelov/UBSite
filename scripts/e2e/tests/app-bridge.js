// @ts-check
// The site inside the Android app (android/): a fake window.UBNative whose "engine" reads a sentence in
// 40 ms. Reading queues the paper ahead and goes on into the next paper by itself; the system player's
// buttons work; opening and closing the player without reading sends the app nothing (a service started
// only to be stopped makes Android close the app).
import { openControlled } from '../lib.js';

/** @param {number} DUR */
function fakeApp(DUR) {
  const w = /** @type {any} */ (window);
  w.__calls = [];
  /** @type {{ id: string }[]} */ let queue = [];
  /** @type {{ id: string } | null} */ let cur = null;
  let timer = 0;
  const next = () => {
    if (cur || !queue.length) return;
    cur = /** @type {{ id: string }} */ (queue.shift());
    setTimeout(() => {
      if (!cur) return;
      w.__ubNative('start', cur.id);
      timer = setTimeout(() => {
        const id = /** @type {{ id: string }} */ (cur).id;
        cur = null;
        w.__ubNative('end', id);
        next();
      }, DUR);
    }, 5);
  };
  w.UBNative = {
    version: () => 2,
    appVersion: () => '1.3',
    voices: () => JSON.stringify([{ id: 'com.google.android.tts|ru-ru-x-ruc-local', name: 'Голос ruc', lang: 'ru-RU', local: true, engine: 'Google' }]),
    speak: (/** @type {string} */ id, /** @type {string} */ text) => (w.__calls.push(['speak', id, text.slice(0, 30)]), queue.push({ id }), next()),
    cancel: () => (w.__calls.push(['cancel']), (queue = []), clearTimeout(timer), (cur = null)),
    player: (/** @type {boolean} */ p) => w.__calls.push(['player', p]),
    meta: (/** @type {string} */ t, /** @type {string} */ a) => w.__calls.push(['meta', a]),
    end: () => w.__calls.push(['end']),
    bars: () => w.__calls.push(['bars']),
    server: () => 'https://upexplorer.ddns.net',
    setServer: () => {},
  };
}

export default {
  name: 'Сайт внутри Android-приложения',
  /** @param {any} t */
  async run(t) {
    const { page, errors } = await t.page({ init: fakeApp, arg: 40 });
    await openControlled(page, '/1');
    await page.waitForTimeout(2500);
    /** @returns {Promise<any[][]>} */
    const calls = () => page.evaluate(() => /** @type {any} */ (window).__calls);
    const app = async () => (await calls()).filter((c) => c[0] === 'player' || c[0] === 'end').map((c) => c.join(':'));
    const listen = page.locator('.bottom-nav').getByText('Слушать');

    await listen.click();
    await page.waitForTimeout(400);
    await listen.click();
    await page.waitForTimeout(400);
    t.check('открыть и закрыть плеер без чтения — приложению ни одной команды', (await app()).length === 0, await app());

    await listen.click();
    await page.waitForTimeout(400);
    await page.locator('.tts-panel button[aria-label="Читать"]').click();
    await page.waitForTimeout(1500);
    const speaks = (await calls()).filter((c) => c[0] === 'speak').length;
    t.check('чтение: весь Текст сразу в очереди движка', speaks > 100, `${speaks} предложений`);
    t.check('подсветка предложения идёт за чтением', (await page.evaluate(() => /** @type {any} */ (CSS).highlights?.get('tts')?.size ?? 0)) === 1);
    await page.waitForTimeout(25000);
    t.check('конец Текста — чтение само продолжается в следующих', !page.url().endsWith('/1'), page.url());

    await page.evaluate(() => /** @type {any} */ (window).__ubNative('cmd', 'pause'));
    await page.evaluate(() => /** @type {any} */ (window).__ubNative('cmd', 'close'));
    await page.waitForTimeout(400);
    t.check('кнопки системного плеера: пауза и закрыть', JSON.stringify((await app()).slice(-2)) === JSON.stringify(['player:false', 'end']), (await app()).slice(-3));
    t.check('без ошибок на странице', errors.length === 0, errors.slice(0, 2));
  },
};
