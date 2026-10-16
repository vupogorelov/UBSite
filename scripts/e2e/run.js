// @ts-check
// End-to-end checks in real browsers (VISION.md, 9–11: the phone, without a network, the one queue).
//
//   cd scripts/e2e && npm install && npm run setup     once
//   npm test                                           all checks, both browsers
//   npm test -- chat                                   only the files whose name has "chat"
//   E2E_ONLY=chromium114 npm test                      one browser
//
// The database is copied (the live one is only read); a server of its own runs on the copy (port 4399).
// Each file in tests/ exports { name, run(t) }; t.check(what, ok, detail) records a result.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareDb, startServer, launch, phone } from './lib.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const filter = process.argv[2] ?? '';
const kinds = /** @type {import('./lib.js').Kind[]} */ (['chrome', 'chromium114'].filter((k) => !process.env.E2E_ONLY || process.env.E2E_ONLY === k));

const token = await prepareDb();
const stop = await startServer();
let failed = 0;
let passed = 0;
try {
  for (const file of readdirSync(`${here}tests`).filter((f) => f.endsWith('.js') && f.includes(filter)).sort()) {
    const test = (await import(pathToFileURL(`${here}tests/${file}`).href)).default;
    for (const kind of kinds) {
      const browser = await launch(kind);
      console.log(`\n${test.name} — ${kind} ${browser.version()}`);
      const t = {
        kind,
        /** @param {{ init?: (arg: any) => void, arg?: unknown }} [opts] */
        page: (opts) => phone(browser, token, opts),
        /** Not signed in. @param {{ init?: (arg: any) => void, arg?: unknown }} [opts] */
        guest: (opts) => phone(browser, '', opts),
        /** @param {string} what @param {boolean} ok @param {unknown} [detail] */
        check(what, ok, detail) {
          ok ? passed++ : failed++;
          console.log(`  ${ok ? '✓' : '✗'} ${what}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
        },
      };
      try {
        await test.run(t);
      } catch (err) {
        failed++;
        console.log(`  ✗ stopped: ${/** @type {Error} */ (err).message.split('\n')[0]}`);
      } finally {
        await browser.close();
      }
    }
  }
} finally {
  stop();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
