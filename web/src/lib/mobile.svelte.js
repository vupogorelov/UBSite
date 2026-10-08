// @ts-check
// Phone layout (< 768 px): the bottom navigation, the compact header, bars that hide while reading.

const query = matchMedia('(max-width: 767px)');

const coarse = matchMedia('(pointer: coarse)');

/** `mobile`: the phone layout; `touch`: a touch screen (phone or tablet). */
export const device = $state({ mobile: query.matches, touch: coarse.matches });
query.addEventListener('change', (e) => (device.mobile = e.matches));
coarse.addEventListener('change', (e) => (device.touch = e.matches));

/** The header and the bottom navigation slide away while the reader scrolls down a text. */
export const chrome = $state({ hidden: false });

let lastY = 0;
let holdUntil = 0;
/** Called on every scroll of the reader. @param {number} y */
export function trackScroll(y) {
  if (!device.mobile) return;
  const dy = y - lastY;
  lastY = y;
  if (Date.now() < holdUntil) return; // the app is scrolling to a place, not the reader
  if (y < 56) chrome.hidden = false;
  else if (dy > 6) chrome.hidden = true;
  else if (dy < -10) chrome.hidden = false;
}

/** After navigating to a place the bars stay visible (the app's own scrolling must not hide them). */
export function holdChrome(ms = 900) {
  holdUntil = Date.now() + ms;
  chrome.hidden = false;
}

/** A tap on the text brings the bars back. */
export function showChrome() {
  chrome.hidden = false;
}
