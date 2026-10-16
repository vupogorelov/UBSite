// @ts-check
// Analytics: once a minute, while the person is active — the tab in view and a tap, scroll or key in the
// last 2 minutes — or while the voice reads, the app tells the server which section is open, whether the
// book is being read and whether it is being listened to, and what it is opened on (a phone or tablet / a
// computer, the installed app / a browser) (server/analytics.js). Nothing else: no texts.
import { api } from './api.js';
import { route } from './router.svelte.js';
import { ui } from './ui.svelte.js';
import { tts } from './tts.svelte.js';
import { native } from './native.js';

const MINUTE = 60_000;
const IDLE = 2 * MINUTE;
/** Sidebar tabs that are sections of their own (the rest — the book's contents, voice — are the book). */
const TABS = ['search', 'notes', 'collections', 'tags', 'translate'];

/** The section on screen. */
function section() {
  const p = route.path;
  if (p === '/chat' || p.startsWith('/chat?')) return 'chat';
  if (p === '/tasks' || p.startsWith('/tasks?')) return 'tasks';
  if (/^\/c\/\d+/.test(p)) return 'collection';
  if (p === '/about') return 'about';
  if (p === '/support') return 'support';
  if (ui.sidebarOpen && TABS.includes(ui.tab)) return ui.tab;
  return 'book';
}

/**
 * What the app is opened on: touch first — a phone or tablet; the Android app (its bridge); the site
 * installed — standalone display; else a browser.
 */
function device() {
  if (native) return 'phone-native';
  const phone = matchMedia('(pointer: coarse)').matches;
  const app = matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  return `${phone ? 'phone' : 'computer'}-${app ? 'app' : 'browser'}`;
}
/** The device's system: Android, iOS (an iPad says it is a Mac, but has touch) or other. */
function system() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

/** Starts the minute's report; returns the stop. */
export function startActivity() {
  let lastInput = Date.now();
  const touched = () => (lastInput = Date.now());
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  for (const e of events) addEventListener(e, touched, { capture: true, passive: true });

  function beat() {
    const visible = document.visibilityState === 'visible';
    const active = visible && Date.now() - lastInput < IDLE;
    const listening = tts.playing;
    if (!active && !listening) return;
    const s = section();
    void api.activity({ section: s, reading: active && s === 'book', listening, device: device(), os: system() }).catch(() => {});
  }
  const timer = setInterval(beat, MINUTE);
  const first = setTimeout(beat, 5_000); // the first minute counts at once
  return () => {
    clearInterval(timer);
    clearTimeout(first);
    for (const e of events) removeEventListener(e, touched, { capture: true });
  };
}
