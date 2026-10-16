// @ts-check
// Where the reader stopped — reading (the first paragraph on screen) and listening (the voice's
// sentence) — kept on the server too, so that it carries over between devices. The latest wins.
// Opened without an address (the app's icon), the app goes to the latest place, wherever it was
// left; opened at an address, or brought back to the screen, it offers the place left on another device.
import { navigate } from './router.svelte.js';
import { settings } from './settings.svelte.js';

/**
 * @typedef {{ paper: number, key: string, s: number, lang: string, progress: number | null,
 *   device: string, deviceKind: 'phone' | 'computer', at: number, file?: string | null, t?: number | null }} Place
 * @typedef {'read' | 'listen'} Kind
 */

const LOCAL_KEY = 'ub.places';
const DEVICE_KEY = 'ub.device';
/** Before the app replaced "/" with the last address: started from the icon, not from a link. */
let startedAtRoot = location.pathname === '/';

/** This browser: a random id (kept) and whether it is a phone. */
export const device = {
  id: (() => {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) localStorage.setItem(DEVICE_KEY, (id = `d-${crypto.randomUUID()}`));
      return id;
    } catch {
      return `d-${crypto.randomUUID()}`;
    }
  })(),
  kind: /** @type {'phone' | 'computer'} */ (matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer'),
};

export const places = $state({
  /** @type {Place | null} */ read: null,
  /** @type {Place | null} */ listen: null,
  /** A newer reading place from another device, offered to go to. @type {Place | null} */ elsewhere: null,
});

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
    places.read = v.read ?? null;
    places.listen = v.listen ?? null;
  } catch {}
}
function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ read: places.read, listen: places.listen }));
  } catch {}
}
readLocal();

/** The address of a place: its paragraph, or its paper for a title. @param {Place} p */
export const placePath = (p) => (p.key.includes(':') ? `/${p.key}` : `/${p.paper}`);

// ---- Saving: at once on this device, to the server a few seconds later (and when the app is hidden) ----

let ready = false; // the server's places are known: until then nothing is sent (a stale one would win)
/** @type {Record<Kind, number>} */ const sentAt = { read: 0, listen: 0 };
/** @type {Record<Kind, ReturnType<typeof setTimeout> | undefined>} */ const timers = { read: undefined, listen: undefined };
/** A listening place set from elsewhere (another device; the eyes in "Общее") reaches the player's progress line through this. @type {(p: Place) => void} */
let onListen = () => {};
/** @param {(p: Place) => void} fn */
export const setListenHandler = (fn) => (onListen = fn);

/** @param {Kind} kind @param {boolean} [keepalive] */
function send(kind, keepalive = false) {
  clearTimeout(timers[kind]);
  const p = places[kind];
  if (!ready || !p || p.device !== device.id || sentAt[kind] === p.at) return;
  sentAt[kind] = p.at;
  fetch(`/api/places/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
    keepalive,
  }).catch(() => (sentAt[kind] = 0));
}

/**
 * @param {Kind} kind
 * @param {{ paper: number, key: string, s?: number, lang: string, progress?: number | null, file?: string | null, t?: number | null }} where
 */
function note(kind, where) {
  const cur = places[kind];
  // (a recording's second counts by tens: written on every second, the place would never settle to be sent)
  const tens = (/** @type {number | null | undefined} */ t) => (t == null ? null : Math.floor(t / 10));
  if (cur && cur.device === device.id && cur.paper === where.paper && cur.key === where.key && cur.s === (where.s ?? 0)
    && (cur.file ?? null) === (where.file ?? null) && tens(cur.t) === tens(where.t)) return;
  places[kind] = { s: 0, progress: null, ...where, device: device.id, deviceKind: device.kind, at: Date.now() };
  writeLocal();
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => send(kind), 4000);
}
// "Место в книге: Общее" (settings.placeMode): reading and listening keep one place — the eyes move it
// when the voice is silent, the voice moves it while it speaks (the screen follows the voice then, and
// its first paragraph is less exact than the sentence being read).
const shared = () => settings.placeMode === 'shared';
let voiceAt = 0;

/** The first paragraph on the reader's screen. @param {{ paper: number, key: string, lang: string, progress?: number | null }} where */
export function noteRead(where) {
  if (shared() && Date.now() - voiceAt < 5000) return; // the voice leads now
  note('read', where);
  if (shared()) {
    note('listen', { ...where, s: 0, lang: places.listen?.lang ?? where.lang });
    if (places.listen) onListen(places.listen);
  }
}
/** The sentence the voice is at. @param {{ paper: number, key: string, s: number, lang: string, progress?: number | null, file?: string | null, t?: number | null }} where */
export function noteListen(where) {
  voiceAt = Date.now();
  note('listen', where);
  if (shared()) note('read', { paper: where.paper, key: where.key, lang: places.read?.lang ?? where.lang, progress: where.progress });
}

/** The place of a kind as the setting sees it: in "Общее" — the latest of the two. @param {Kind} kind */
function effective(kind, /** @type {{ read: Place | null, listen: Place | null }} */ p) {
  if (!shared()) return p[kind];
  const [a, b] = [p.read, p.listen];
  return !a ? b : !b ? a : a.at >= b.at ? a : b;
}

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    send('read', true);
    send('listen', true);
  } else void syncPlaces(); // back from another device, maybe
});
addEventListener('pagehide', () => (send('read', true), send('listen', true)));

// ---- Loading: the server's places against this device's ----

let lastSync = 0;
/** After sign-in and on coming back to the app: takes newer places from the server. */
export async function syncPlaces() {
  if (Date.now() - lastSync < 15_000) return;
  lastSync = Date.now();
  /** @type {{ read: Place | null, listen: Place | null } | null} */
  let server = null;
  try {
    const res = await fetch('/api/places');
    if (res.ok) server = await res.json();
  } catch {}
  ready = true;
  const atRoot = startedAtRoot;
  startedAtRoot = false;
  if (!server) return;
  // In "Общее" the latest of the two places stands for both (here and on the server).
  const before = effective('read', { read: places.read, listen: places.listen });
  const listen = effective('listen', server);
  if (listen && (!places.listen || listen.at > places.listen.at)) {
    places.listen = listen;
    if (listen.device !== device.id || shared()) onListen(listen);
  }
  const read = effective('read', server);
  if (read && (!places.read || read.at > places.read.at)) {
    places.read = read;
    if (read.device !== device.id && (!before || read.at > before.at) && read.key !== before?.key) {
      if (atRoot) navigate(placePath(read), { replace: true });
      else places.elsewhere = read;
    }
  }
  writeLocal();
  // places of this device that the server has not got yet (made offline)
  if (places.read?.device === device.id) send('read');
  if (places.listen?.device === device.id) send('listen');
}

/** Signed out: this device forgets the places (another person may sign in here). */
export function forgetPlaces() {
  places.read = places.listen = places.elsewhere = null;
  ready = false;
  lastSync = 0;
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {}
}
