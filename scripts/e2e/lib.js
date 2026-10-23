// @ts-check
// The test bench: a copy of the database with a session, a server of its own on another port, and the
// two browsers — the current Chrome (installed on the computer) and Chromium 114 (setup.js).
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
export const PORT = Number(process.env.E2E_PORT ?? 4399);
// a service worker needs a secure context: localhost is one
export const BASE = `http://localhost:${PORT}`;
/** Chromium 114, outside the project (it is on a synced disk). */
export const BROWSERS = process.env.E2E_BROWSERS ?? `${process.env.LOCALAPPDATA ?? process.env.HOME}/ubsite-e2e/browsers`;

/**
 * Copies the database (only read) and signs in its first person on the copy. `name`: a copy of its own (a
 * worker's: the workers run side by side, each with its own copy, server and Laboratory file).
 * @param {string} [name] @returns {Promise<string>} the session
 */
export async function prepareDb(name = 'test') {
  const tmp = `${here}.tmp/`;
  mkdirSync(tmp, { recursive: true });
  const copy = `${tmp}${name}.db`;
  for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) rmSync(f, { force: true });
  process.env.UB_LAB_DB = `${tmp}${name}-lab.db`;
  const live = new DatabaseSync(process.env.UB_DB ?? `${root}data/ub.db`, { readOnly: true });
  live.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  live.close();
  process.env.UB_DB = copy;
  const { openDb } = await import(pathToFileURL(`${root}server/db.js`).href);
  const { createAuth } = await import(pathToFileURL(`${root}server/auth.js`).href);
  const db = openDb(copy);
  const user = /** @type {{ id: number }} */ (db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get());
  const token = createAuth(db).createSession(user.id);
  db.close();
  return token;
}

/** The server on the copy. @returns {Promise<() => void>} its stop */
export async function startServer() {
  const env = { ...process.env, UB_PORT: String(PORT), UB_BACKUPS: '0', UB_ENV_FILE: `${here}.tmp/none.env` };
  writeFileSync(`${here}.tmp/none.env`, '');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', `${root}server/main.js`], { env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      if ((await fetch(`${BASE}/api/auth/me`)).ok) return () => child.kill();
    } catch {}
  }
  child.kill();
  throw new Error('The test server did not start');
}

/** @typedef {'chrome' | 'chromium114'} Kind */

/** @param {Kind} kind */
export async function launch(kind) {
  if (kind === 'chromium114') {
    process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS;
    const { chromium } = await import('pw114');
    return chromium.launch({ headless: true });
  }
  const { chromium } = await import('playwright-core');
  return chromium.launch({ channel: 'chrome', headless: true });
}

/**
 * A phone-sized page signed in on the copy (token '' — a guest, not signed in). `bypassCSP`: the old
 * Playwright evaluates its waits as strings, which the site's policy forbids.
 * @param {any} browser @param {string} token @param {{ init?: (arg: any) => void, arg?: unknown }} [opts]
 */
export async function phone(browser, token, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bypassCSP: true });
  if (token) await ctx.addCookies([{ name: 'ub_session', value: token, url: BASE }]);
  if (opts.init) await ctx.addInitScript(opts.init, opts.arg);
  const page = await ctx.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ e) => errors.push(String(e)));
  return { ctx, page, errors };
}

/**
 * A computer-sized page (a mouse, no touch) signed in on the copy.
 * @param {any} browser @param {string} token
 */
export async function computer(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, bypassCSP: true });
  await ctx.addCookies([{ name: 'ub_session', value: token, url: BASE }]);
  const page = await ctx.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ e) => errors.push(String(e)));
  return { ctx, page, errors };
}

/**
 * Waits until `ok` holds (asked every `every` ms), at most `timeout` ms — not a fixed time: a check goes on as
 * soon as what it waits for is there. Never throws: the check after it says what was found.
 * @param {() => Promise<unknown> | unknown} ok @param {{ timeout?: number, every?: number }} [opts]
 */
export async function until(ok, { timeout = 10000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await ok()) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, every));
  }
  return false;
}

/** Opens a path under the service worker (the second load is controlled by it). @param {any} page @param {string} path */
export async function openControlled(page, path) {
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 }).catch(() => {});
  await page.reload({ waitUntil: 'load' });
}

/** The book copy is on the device. @param {any} page */
export const waitCopy = (page) =>
  page.waitForFunction(() => JSON.parse(localStorage.getItem('ub.offline') ?? 'null')?.build, null, { timeout: 120000 });
