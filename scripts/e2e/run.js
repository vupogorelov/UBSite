// @ts-check
// End-to-end checks in real browsers (VISION.md, 9–11: the phone, without a network, the one queue).
//
//   cd scripts/e2e && npm install && npm run setup     once
//   npm run e2e                                        all checks, both browsers
//   npm run e2e -- chat                                only the files whose name has "chat"
//   npm run e2e -- --quick [chat]                      the current Chrome only (while working; both before a release)
//   E2E_ONLY=chromium114 npm run e2e                   one browser
//   E2E_WORKERS=1 npm run e2e                          one after another (as before; the workers' default: 4)
//
// The database is copied (the live one is only read); a server of its own runs on each copy. The checks run
// side by side in workers — each a process with its own copy, server and port (4400 + its number), so no
// check sees another's changes. The longest go first, each to the least busy worker (the times of the last
// run: .tmp/durations.json). Each file in tests/ exports { name, run(t) }; t.check(what, ok, detail) records
// a result. A worker prints a check's lines together, when it is done.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const DURATIONS = `${here}.tmp/durations.json`;

/** @typedef {{ file: string, kind: import('./lib.js').Kind }} Job */

if (process.env.E2E_JOBS) await worker(JSON.parse(process.env.E2E_JOBS));
else await main();

async function main() {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith('--')) ?? '';
  const only = args.includes('--quick') ? 'chrome' : process.env.E2E_ONLY;
  const kinds = /** @type {import('./lib.js').Kind[]} */ (['chrome', 'chromium114'].filter((k) => !only || only === k));
  const files = readdirSync(`${here}tests`).filter((f) => f.endsWith('.js') && f.includes(filter)).sort();
  /** @type {Record<string, number>} */
  let durations = {};
  try {
    durations = JSON.parse(readFileSync(DURATIONS, 'utf8'));
  } catch {}
  const took = (/** @type {Job} */ j) => durations[`${j.file}|${j.kind}`] ?? 15;
  /** @type {Job[]} */
  const jobs = files.flatMap((file) => kinds.map((kind) => ({ file, kind }))).sort((a, b) => took(b) - took(a));
  const n = Math.max(1, Math.min(Number(process.env.E2E_WORKERS ?? 4), jobs.length));
  // the longest first, each to the least busy worker
  const plan = Array.from({ length: n }, () => ({ jobs: /** @type {Job[]} */ ([]), load: 0 }));
  for (const j of jobs) {
    const w = plan.reduce((a, b) => (b.load < a.load ? b : a));
    w.jobs.push(j);
    w.load += took(j);
  }
  const t0 = Date.now();
  const results = await Promise.all(plan.map((w, i) => runWorker(i, w.jobs)));
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    passed += r.passed;
    failed += r.failed;
    Object.assign(durations, r.durations);
  }
  mkdirSync(`${here}.tmp`, { recursive: true });
  writeFileSync(DURATIONS, JSON.stringify(durations, null, 1));
  console.log(`\n${passed} passed, ${failed} failed · ${((Date.now() - t0) / 1000).toFixed(0)} s, ${n} workers`);
  process.exit(failed ? 1 : 0);
}

/**
 * A worker: this script again, with its jobs, its copy and its port; its lines go on to the console as they come.
 * @param {number} i @param {Job[]} jobs
 * @returns {Promise<{ passed: number, failed: number, durations: Record<string, number> }>}
 */
function runWorker(i, jobs) {
  return new Promise((resolve) => {
    const env = { ...process.env, E2E_JOBS: JSON.stringify(jobs), E2E_PORT: String(4400 + i), E2E_NAME: `test-${i}` };
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    let result = { passed: 0, failed: 1, durations: {} }; // (a worker that ends without its result has failed)
    let rest = '';
    child.stdout.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('@@result ')) result = JSON.parse(line.slice(9));
        else console.log(line);
      }
    });
    child.on('close', () => resolve(result));
  });
}

/** @param {Job[]} jobs */
async function worker(jobs) {
  const { prepareDb, startServer, launch, phone, computer } = await import('./lib.js');
  const token = await prepareDb(process.env.E2E_NAME);
  const stop = await startServer();
  let failed = 0;
  let passed = 0;
  /** @type {Record<string, number>} */
  const durations = {};
  try {
    for (const { file, kind } of jobs) {
      const test = (await import(pathToFileURL(`${here}tests/${file}`).href)).default;
      const t0 = Date.now();
      const browser = await launch(kind);
      /** @type {string[]} */
      const out = [`\n${test.name} — ${kind} ${browser.version()} [${file}]`];
      const t = {
        kind,
        /** @param {{ init?: (arg: any) => void, arg?: unknown }} [opts] */
        page: (opts) => phone(browser, token, opts),
        /** A computer (a mouse, no touch). */
        computer: () => computer(browser, token),
        /** Not signed in. @param {{ init?: (arg: any) => void, arg?: unknown }} [opts] */
        guest: (opts) => phone(browser, '', opts),
        /** @param {string} what @param {boolean} ok @param {unknown} [detail] */
        check(what, ok, detail) {
          ok ? passed++ : failed++;
          out.push(`  ${ok ? '✓' : '✗'} ${what}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
        },
      };
      try {
        await test.run(t);
      } catch (err) {
        failed++;
        out.push(`  ✗ stopped: ${/** @type {Error} */ (err).message.split('\n')[0]}`);
      } finally {
        await browser.close();
        const s = (Date.now() - t0) / 1000;
        durations[`${file}|${kind}`] = Math.round(s * 10) / 10;
        out.push(`  ⏱ ${s.toFixed(1)} s`);
        console.log(out.join('\n'));
      }
    }
  } finally {
    stop();
  }
  // (out before the exit: the result is the last line the main process reads)
  process.stdout.write(`@@result ${JSON.stringify({ passed, failed, durations })}\n`, () => process.exit(0));
}
