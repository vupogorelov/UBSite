// @ts-check
// Player buttons in the notification shade and on the lock screen while reading aloud.
// The system shows them only for a page that plays media, so while the voice reads, a silent track
// loops in an <audio> element (silence is enough — checked on a phone) and the Media Session API
// names it and handles the buttons. It does not keep the voice going in the background: Chrome on
// Android stops speech synthesis as soon as the page is hidden, whatever the page plays.

/** @type {HTMLAudioElement | null} */
let audio = null;

/**
 * Starts the track and the system player; call within a tap (browsers allow audio then).
 * @param {{ play: () => void, pause: () => void, next: () => void, prev: () => void }} h
 */
export function bgStart(h) {
  if (!audio) {
    audio = new Audio('/audio/silence.mp3');
    audio.loop = true;
  }
  audio.play().catch(() => {});
  const ms = navigator.mediaSession;
  if (!ms) return;
  ms.playbackState = 'playing';
  /** @type {[MediaSessionAction, () => void][]} */
  const actions = [['play', h.play], ['pause', h.pause], ['stop', h.pause], ['nexttrack', h.next], ['previoustrack', h.prev]];
  for (const [name, fn] of actions) {
    try {
      ms.setActionHandler(name, () => fn());
    } catch {} // not every action exists everywhere
  }
}

/** The voice stopped. */
export function bgStop() {
  audio?.pause();
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
}

/** What the system player shows. @param {string} title @param {string} album */
export function bgMeta(title, album) {
  if (!navigator.mediaSession || typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: 'Urantian Docs Explorer',
    album,
    artwork: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}
