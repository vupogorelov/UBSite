// @ts-check
// Phone layout (< 768 px): the bottom navigation, the compact header, bars that hide while reading
// (unless Настройки → Панели → «Прятать панели при прокрутке» is off).
import { settings } from './settings.svelte.js';

const query = matchMedia('(max-width: 767px)');

const coarse = matchMedia('(pointer: coarse)');

/** `mobile`: the phone layout; `touch`: a touch screen (phone or tablet). */
export const device = $state({ mobile: query.matches, touch: coarse.matches });
query.addEventListener('change', (e) => (device.mobile = e.matches));
coarse.addEventListener('change', (e) => (device.touch = e.matches));

/** The header and the bottom navigation slide away while the reader scrolls down a text. */
export const chrome = $state({ hidden: false, scrolled: false });

let lastY = 0;
let holdUntil = 0;
/** Called on every scroll of the reader. @param {number} y */
export function trackScroll(y) {
  if (!device.mobile) return;
  if (!settings.barsAutoHide) return void (chrome.hidden = false);
  const dy = y - lastY;
  lastY = y;
  chrome.scrolled = y > 8; // the text has gone under the header: its line shows
  if (Date.now() < holdUntil) return; // the app is scrolling to a place, not the reader
  if (y < 56) chrome.hidden = false;
  else if (dy > 6) chrome.hidden = true;
  else if (dy < -10) chrome.hidden = false;
}

/** After navigating to a place the bars stay visible (the app's own scrolling must not hide them). */
export function holdChrome(ms = 900, show = true) {
  holdUntil = Date.now() + ms;
  if (show) chrome.hidden = false;
}

/** A tap on the text brings the bars back. */
export function showChrome() {
  chrome.hidden = false;
}

// ---- The on-screen keyboard ----
// The page shrinks while it is up (interactive-widget=resizes-content). It is marked on <html>
// (data-keyboard) only while it is really there — not by a field's focus: hidden with the system
// "back", the keyboard goes but the focus stays, and the layout must come back at once (not on the
// next tap, which would move what is under the finger).
if (typeof window !== 'undefined') {
  let full = innerHeight;
  let wide = innerWidth;
  const check = () => {
    if (innerWidth !== wide) {
      // turned: the full height is the new one
      wide = innerWidth;
      full = innerHeight;
    }
    full = Math.max(full, innerHeight);
    const up = innerHeight < full - 120;
    if (up) document.documentElement.dataset.keyboard = 'open';
    else delete document.documentElement.dataset.keyboard;
  };
  addEventListener('resize', check);
}
