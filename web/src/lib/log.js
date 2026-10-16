// @ts-check
// The journal of this device (TODO.md "Журнал событий"): what happened before a failure, so that it is
// seen as it was, not retold. The last events are kept on the device and sent to the server in batches
// (server/clientlog.js) — at once after a failure, otherwise now and then; without a network they wait.
// Administrators read them (Администрирование → Журнал).
//
// What is kept: the screens (paths), the buttons pressed (by their names, aria-label or title — never
// the texts of notes, messages or searches), the server's failed or slow answers (method and path, no
// query), the page's own failures, the reading aloud, the network, the book's copy, the outgoing queue,
// and the Android app's own failures (android/: a crash, why the system closed it). Shown in "О приложении".

import { native } from './native.js';

/** @typedef {'info' | 'warn' | 'error'} Level */
/** @typedef {{ at: string, level: Level, kind: string, name: string, data?: unknown }} LogEvent */

const KEY = 'ub.log';
const KEEP = 500;
/** One opening of the app (a tab). */
const SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** What the app is opened on: phone or computer, the app or a browser, versions. */
function deviceName() {
  const phone = matchMedia('(pointer: coarse)').matches ? 'телефон' : 'компьютер';
  const app = native ? `приложение ${native.version() >= 2 ? (native.appVersion?.() ?? '') : '1.0–1.2'}` : matchMedia('(display-mode: standalone)').matches ? 'установленный сайт' : 'браузер';
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
  const engine = chrome ? `Chrome ${chrome}` : /Safari\//.test(navigator.userAgent) ? 'Safari' : 'браузер';
  return `${phone} · ${app.trim()} · ${engine} · сборка ${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`;
}

/** @type {LogEvent[]} */
let pending = [];
try {
  pending = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  if (!Array.isArray(pending)) pending = [];
} catch {}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(pending));
    } catch {}
  }, 500);
}

/**
 * Notes an event. @param {string} kind @param {string} name @param {unknown} [data] @param {Level} [level]
 */
export function log(kind, name, data, level = 'info') {
  /** @type {LogEvent} */
  const e = { at: new Date().toISOString(), level, kind, name: String(name).slice(0, 160) };
  if (data !== undefined) e.data = data;
  pending.push(e);
  if (pending.length > KEEP) pending = pending.slice(-KEEP);
  save();
  if (level === 'error') flushSoon(2000);
}

let sending = false;
let flushTimer = 0;
/** @param {number} ms */
function flushSoon(ms) {
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, ms);
}

/** Sends what was not sent yet (directly — not through api.js, whose failures are themselves noted). */
export async function flush(keepalive = false) {
  if (sending || !pending.length) return;
  sending = true;
  const batch = pending.slice(0, 300);
  try {
    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: SESSION, device: deviceName(), events: batch }),
      keepalive,
    });
    if (res.ok) {
      pending = pending.slice(batch.length);
      save();
    }
  } catch {
    // (no network: they wait)
  } finally {
    sending = false;
  }
}

// ---- What is noted by itself ----

if (typeof window !== 'undefined') {
  addEventListener('error', (e) => log('error', e.message || 'Ошибка', { at: `${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}`, stack: String(e.error?.stack ?? '').split('\n').slice(0, 6).join('\n') }, 'error'));
  addEventListener('unhandledrejection', (e) => {
    const r = /** @type {any} */ (e.reason);
    log('error', `Необработанный отказ: ${r?.message ?? String(r)}`, { stack: String(r?.stack ?? '').split('\n').slice(0, 6).join('\n') }, 'error');
  });
  // the app's own "not loaded" / "not saved" lines
  for (const [method, level] of /** @type {const} */ ([['error', 'error'], ['warn', 'warn']])) {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      orig(...args);
      const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).filter(Boolean).join(' ');
      if (text) log('console', text.slice(0, 160), undefined, level);
    };
  }
  addEventListener('online', () => log('network', 'связь есть'));
  addEventListener('offline', () => log('network', 'нет связи', undefined, 'warn'));
  document.addEventListener('visibilitychange', () => {
    log('app', document.visibilityState === 'visible' ? 'на экране' : 'скрыто');
    if (document.visibilityState === 'hidden') void flush(true);
  });
  // A button pressed: by its name (aria-label, title). Its visible text only in the app's own frame —
  // the bottom bar, menus, settings, the selection's and the player's panels, headers — never in the
  // content (the book, messages, notes, search results): there only its class.
  const FRAME = '.bottom-nav, .more-sheet, .set-list, .settings-drawer, .sel-toolbar, .tts-panel, .topbar, .drawer-head, .tg-chat-head, .ui-chips, .search-tools';
  document.addEventListener(
    'click',
    (e) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target)?.closest?.('button, a, [role="button"], [role="radio"], [role="tab"]'));
      if (!el) return;
      const text = el.closest(FRAME) ? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) : '';
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || text || (el.className && String(el.className).split(/\s+/)[0]) || el.tagName.toLowerCase();
      log('tap', name);
    },
    true,
  );
  setInterval(() => document.visibilityState === 'visible' && void flush(), 60_000);
  log('app', 'открыто', { device: deviceName(), screen: `${screen.width}×${screen.height}`, path: location.pathname });
  // the Android app's own events since the last time (a crash, why the system closed it, its player)
  try {
    if (native && native.version() >= 3) {
      for (const e of JSON.parse(/** @type {any} */ (native).takeLog() || '[]')) {
        pending.push({ at: e.at ?? new Date().toISOString(), level: e.level ?? 'info', kind: 'android', name: String(e.name).slice(0, 160), data: e.data });
        if (e.level === 'error') flushSoon(2000);
      }
      save();
    }
  } catch {}
  setTimeout(flush, 5000);
}
