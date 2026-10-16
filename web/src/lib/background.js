// @ts-check
// Player buttons in the notification shade and on the lock screen while reading aloud.
// The system shows them only for a page that plays media, so while the voice reads, a silent track
// loops in an <audio> element (silence is enough — checked on a phone) and the Media Session API
// names it and handles the buttons. It does not keep the voice going in the background: Chrome on
// Android stops speech synthesis as soon as the page is hidden, whatever the page plays.
// In the Android app (native.js) the app shows the system player itself and reading goes on.

import { native, setCommandHandler } from './native.js';

/** @type {HTMLAudioElement | null} */
let audio = null;
/**
 * The app's system player is on (reading started since the player opened). Pause and close go to the
 * app only then: a player started just to be stopped makes Android close the app.
 */
let nativeOn = false;

/**
 * Starts the track and the system player; call within a tap (browsers allow audio then).
 * A recording plays itself: no silent track then (`silent` false), and its ⏪ ⏩ move it by seconds.
 * @param {{ play: () => void, pause: () => void, next: () => void, prev: () => void, close: () => void, seek?: (sec: number) => void }} h
 * @param {boolean} [silent]
 */
export function bgStart(h, silent = true) {
  if (native) {
    setCommandHandler((cmd) => ({ play: h.play, pause: h.pause, next: h.next, prev: h.prev, close: h.close })[cmd]?.());
    native.player(true);
    nativeOn = true;
    return;
  }
  if (silent) {
    if (!audio) {
      audio = new Audio('/audio/silence.mp3');
      audio.loop = true;
    }
    audio.play().catch(() => {});
  } else audio?.pause();
  const ms = navigator.mediaSession;
  if (!ms) return;
  ms.playbackState = 'playing';
  const seek = h.seek;
  /** @type {[MediaSessionAction, ((d: MediaSessionActionDetails) => void) | null][]} */
  const actions = [
    ['play', h.play], ['pause', h.pause], ['stop', h.pause], ['nexttrack', h.next], ['previoustrack', h.prev],
    ['seekbackward', seek ? (d) => seek(-(d.seekOffset ?? 15)) : null],
    ['seekforward', seek ? (d) => seek(d.seekOffset ?? 15) : null],
  ];
  for (const [name, fn] of actions) {
    try {
      ms.setActionHandler(name, fn && ((d) => fn(d)));
    } catch {} // not every action exists everywhere
  }
}

/** The voice stopped. */
export function bgStop() {
  if (nativeOn) native?.player(false);
  audio?.pause();
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
}

/** The player closed: the system player goes away (in the app; a browser hides it by itself). */
export function bgEnd() {
  if (nativeOn) native?.end();
  nativeOn = false;
}

/** What the system player shows. @param {string} title @param {string} album */
export function bgMeta(title, album) {
  if (native) return native.meta(title, album);
  if (!navigator.mediaSession || typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: 'Urantia Papers Explorer',
    album,
    artwork: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}
