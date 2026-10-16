// @ts-check
// Paths: /5 (paper), /5:1 (section), /5:1.3 (paragraph).
import { log } from './log.js';

/** @typedef {{ paper: number | null, section: number | null, ref: string | null }} Target */

const LAST_KEY = 'ub.last';

/** @param {string} pathname @returns {Target} */
export function parsePath(pathname) {
  // (a book address may carry a query: a shared quote "/5:1.3?sel=ru.120-184" — lib/share.js)
  const m = decodeURIComponent(pathname.split('?')[0]).match(/^\/(\d+)(?::(\d+)(?:\.(\d+))?)?\/?$/);
  if (!m) return { paper: null, section: null, ref: null };
  return {
    paper: Number(m[1]),
    section: m[2] === undefined ? null : Number(m[2]),
    ref: m[3] === undefined ? null : `${Number(m[1])}:${Number(m[2])}.${Number(m[3])}`,
  };
}

/** Navigation target; `nav` increments on every navigation so re-clicking the same link re-scrolls. */
// (`path` with its query, as navigate() gives it: a link opened from outside — /chat?c=… — is the same screen)
export const route = $state({ ...parsePath(location.pathname), path: location.pathname + location.search, nav: 0 });

/** What the reader is currently showing (updated while scrolling). */
export const view = $state({ paper: /** @type {number | null} */ (null), section: /** @type {number | null} */ (null) });

/** The address on screen (it changes while the reader scrolls): restored after a guarded "back". */
let shownPath = location.pathname + location.search;

// ---- The screens "back" walks through (phone) ----
// Every navigate() is a step: a jump in the book (a link, the contents, search, a note), a chat, a task,
// a collection… Scrolling is not (it only rewrites the address of the step on top). The sections of the
// bottom navigation (Чат, Задачи, «О приложении», «Поддержать») do not pile up: opening one starts over
// from the book — the latest place in it — so "back" from any section leads to the book; the steps
// inside a section do pile up. The bottom is always the book: an app opened elsewhere (a link to a
// message) gets it below. Kept for the tab (sessionStorage): it survives the phone unloading the page.
const STACK_KEY = 'ub.screens';
const isBook = (/** @type {string} */ p) => /^\/\d+(?::\d+(?:\.\d+)?)?\/?$/.test(p.split('?')[0]);
const isSection = (/** @type {string} */ p) => p === '/chat' || p === '/tasks' || p === '/about' || p === '/support';

/** @returns {string[]} */
function loadStack() {
  const here = location.pathname + location.search;
  try {
    const s = JSON.parse(sessionStorage.getItem(STACK_KEY) ?? '[]');
    if (Array.isArray(s) && s.length && s.at(-1) === here) return s;
  } catch {}
  return isBook(here) ? [here] : [lastPath(), here];
}
const screens = loadStack();
function saveStack() {
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(screens.slice(-50)));
  } catch {}
}
saveStack();

/**
 * @param {string} path
 * @param {{ replace?: boolean, root?: boolean }} [opts] `replace`: the same step, another address;
 *   `root`: back to the book as a section ("К книге", the bottom bar) — the steps start over from it.
 */
export function navigate(path, opts = {}) {
  shownPath = path;
  if (opts.replace) history.replaceState(history.state, '', path);
  else history.pushState({ i: (history.state?.i ?? 0) + 1 }, '', path);
  if (opts.root) screens.splice(0, screens.length, path);
  else if (opts.replace) screens[screens.length - 1] = path;
  else if (isSection(path)) {
    const book = screens.findLast(isBook) ?? lastPath();
    screens.splice(0, screens.length, book, path);
  } else if (screens.at(-1) !== path) screens.push(path);
  saveStack();
  Object.assign(route, parsePath(path), { path, nav: route.nav + 1 });
  log('screen', path.split('?')[0] + (path.includes('?c=') ? ` · ${decodeURIComponent(path.split('?c=')[1].split('&')[0])}` : ''));
}

/**
 * One step back through the screens (the phone's "back" when nothing is open, or an arrow on screen).
 * @param {string} [fallback] where to go when there is no step below (an arrow's own target)
 * @returns {boolean} whether there was a step to go back to
 */
export function back(fallback) {
  if (screens.length < 2) {
    if (fallback) navigate(fallback, { replace: true });
    return false;
  }
  screens.pop();
  const path = /** @type {string} */ (screens.at(-1));
  saveStack();
  shownPath = path;
  history.replaceState(history.state, '', path);
  Object.assign(route, parsePath(path), { path, nav: route.nav + 1 });
  return true;
}

/** Updates the address bar (e.g. while scrolling) without triggering navigation. */
export function replaceUrl(/** @type {string} */ path) {
  shownPath = path;
  if (location.pathname + location.search !== path) history.replaceState(history.state, '', path);
  if (isBook(path) && isBook(screens.at(-1) ?? '')) {
    screens[screens.length - 1] = path; // "back" returns to where the reading was, not where it began
    saveStack();
  }
  try {
    localStorage.setItem(LAST_KEY, path);
  } catch {}
}

/** The book's place to come back to (reading aloud moved on while another page was open). @param {string} path */
export function rememberBookPath(path) {
  try {
    localStorage.setItem(LAST_KEY, path);
  } catch {}
}

export function lastPath() {
  try {
    return localStorage.getItem(LAST_KEY) ?? '/0';
  } catch {
    return '/0';
  }
}

/**
 * onclick handler for internal <a href>: keeps ctrl/middle-click opening a new tab.
 * @param {MouseEvent} e
 */
export function linkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = /** @type {HTMLAnchorElement} */ (e.currentTarget);
  e.preventDefault();
  navigate(a.getAttribute('href') ?? '/');
}

// ---- "Back" (Android gesture or button) ----
// On a phone "back" first closes what is open or stops reading (the latest handler that has something
// to do), then goes one screen back (see `screens` above); in the book with nothing below it shows
// "back once more to leave" and the next "back" leaves the app.
//
// Every entry the app adds carries its depth `i` above the app's first entry (i = 0). Chrome skips
// "back" over entries a page added without a tap, so the reserve of entries is topped up on taps:
// at least two above the first one — one for "close / stop", one for the warning.
// On a computer "back" closes what is open, otherwise it is the browser's usual "back".

// Touch screens only: an app installed on a computer behaves as a browser window there.
const strict = matchMedia('(pointer: coarse)').matches;

/** The "back once more to leave" bar. */
export const exitPrompt = $state({ shown: false });

/** @type {(() => boolean | void)[]} */
const handlers = [];
let ignorePops = 0;

if (history.state?.i === undefined) history.replaceState({ ...history.state, i: 0 }, '', location.pathname + location.search);

/** With a tap in progress (entries added now are not skipped): keep two entries in reserve. */
function topUp() {
  exitPrompt.shown = false;
  if (!strict) return;
  for (let i = history.state?.i ?? 0; i < 2; i++) history.pushState({ i: i + 1 }, '', location.pathname + location.search);
}
// The events that count as a user's action for the browser (a tap on text gives no click).
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(type, topUp, true);

/**
 * Something open on screen reacts to "back"; the handler returns false when it has nothing to do
 * (e.g. the player is already silent) and the next one below is asked.
 * @param {() => boolean | void} handler @returns {() => void} unregister
 */
export function onBack(handler) {
  handlers.push(handler);
  if (strict) {
    if (navigator.userActivation?.isActive) topUp();
  } else if (!history.state?.guard) history.pushState({ i: (history.state?.i ?? 0) + 1, guard: true }, '', location.pathname + location.search);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

function act() {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]() !== false) return true;
  return false;
}

addEventListener('popstate', (e) => {
  if (ignorePops > 0) {
    ignorePops--;
    history.replaceState(history.state, '', shownPath);
    return;
  }
  const depth = e.state?.i ?? 0;
  if (!strict) {
    // Computer: an open panel closes and the address stays; otherwise the usual navigation.
    if (handlers.length && act()) {
      history.replaceState(e.state, '', shownPath);
      return;
    }
    shownPath = location.pathname + location.search;
    // the browser's own "back" / "forward": the screens follow it
    if (screens.at(-2) === shownPath) screens.pop();
    else screens[screens.length - 1] = shownPath;
    saveStack();
    Object.assign(route, parsePath(location.pathname), { path: shownPath, nav: route.nav + 1 });
    return;
  }
  history.replaceState(e.state, '', shownPath); // the screen stays as it is until a step is taken
  if (act() || back()) {
    if (depth === 0) exitPrompt.shown = true; // the reserve is used up: the next "back" leaves
    return;
  }
  // Nothing to close and no screen below: warn, and go down to the app's first entry so the next "back" leaves.
  exitPrompt.shown = true;
  if (depth > 0) {
    ignorePops++;
    history.go(-depth);
  }
});
