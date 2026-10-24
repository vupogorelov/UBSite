// @ts-check
// The Android app (android/): the site in a window of its own, with the phone's speech synthesis
// that goes on with the screen off and a system player (notification shade, lock screen,
// headphones). The app gives the page `window.UBNative` and answers with `window.__ubNative(type, id)`;
// in a browser there is no bridge and `native` is null.
//
// `nativeSynth` stands in for `speechSynthesis` (the same speak/cancel/getVoices and utterances with
// onstart/onend/onerror), so the reader drives either. Unlike the browser's, the app's engine keeps
// reading a queue while the page sleeps: the reader queues the sentences ahead (tts.svelte.js).

/** @type {any} */
const w = typeof window === 'undefined' ? {} : window;

/**
 * @typedef {{ version(): number, voices(): string, speak(id: string, text: string, lang: string, voice: string, rate: number, pitch: number, volume: number): void,
 *   cancel(): void, player(playing: boolean): void, meta(title: string, album: string): void, end(): void, bars(top: string, bottom: string): void,
 *   server(): string, setServer(url: string): void, appVersion?(): string, installApp?(url: string): void }} Bridge
 * (version 2 and later: appVersion, and a download — the app's APK — goes to the system browser; 5: installApp —
 * the app downloads its update itself and hands it to the system's installer)
 */
/** @type {Bridge | null} */
export const native = w.UBNative ?? null;

/** An utterance for the app's engine (as SpeechSynthesisUtterance). */
export class NativeUtterance {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.lang = '';
    /** @type {{ voiceURI: string } | null} */
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    /** @type {(() => void) | null} */
    this.onstart = null;
    /** @type {(() => void) | null} */
    this.onend = null;
    /** @type {((e: { error: string }) => void) | null} */
    this.onerror = null;
  }
}

/** Utterances queued in the engine, by the id it reports them by. @type {Map<string, NativeUtterance>} */
const queued = new Map();
let seq = 0;
/** @type {Set<() => void>} */
const voicesChanged = new Set();
/** The phone's voices; `engine`: whose ("Google", "Huawei"…). @type {{ voiceURI: string, name: string, lang: string, localService: boolean, engine: string }[] | null} */
let voiceList = null;
/** The system player's buttons. @type {((cmd: string) => void) | null} */
let onCommand = null;

/** @param {(cmd: 'play' | 'pause' | 'next' | 'prev' | 'close') => void} fn */
export function setCommandHandler(fn) {
  onCommand = /** @type {(cmd: string) => void} */ (fn);
}
/** The app's update being downloaded: "<percent>", "install", "error:<why>". @type {((state: string) => void) | null} */
let onUpdate = null;
/** @param {(state: string) => void} fn */
export function setUpdateHandler(fn) {
  onUpdate = fn;
}

export const nativeSynth = native && {
  native: true,
  speaking: false,
  pending: false,
  paused: false,
  /** @param {NativeUtterance} u */
  speak(u) {
    const id = String(++seq);
    queued.set(id, u);
    this.pending = true;
    native?.speak(id, u.text, u.lang, u.voice?.voiceURI ?? '', u.rate, u.pitch, u.volume);
  },
  cancel() {
    queued.clear();
    this.speaking = this.pending = false;
    native?.cancel();
  },
  resume() {},
  getVoices() {
    if (!voiceList) {
      try {
        /** @type {{ id: string, name: string, lang: string, local: boolean, engine?: string }[]} */
        const list = JSON.parse(native?.voices() ?? '[]');
        voiceList = list.map((v) => ({ voiceURI: v.id, name: v.name, lang: v.lang, localService: v.local, engine: v.engine ?? '' }));
      } catch {
        voiceList = [];
      }
    }
    return voiceList;
  },
  /** @param {string} type @param {() => void} fn */
  addEventListener(type, fn) {
    if (type === 'voiceschanged') voicesChanged.add(fn);
  },
};

if (native && nativeSynth) {
  /** @param {string} type @param {string} id */
  w.__ubNative = (type, id) => {
    if (type === 'cmd') return onCommand?.(id);
    if (type === 'update') return onUpdate?.(id);
    if (type === 'voices') {
      voiceList = null;
      for (const fn of voicesChanged) fn();
      return;
    }
    const u = queued.get(id);
    if (!u) return; // (cancelled)
    if (type === 'start') {
      nativeSynth.speaking = true;
      u.onstart?.();
    } else {
      queued.delete(id);
      nativeSynth.pending = nativeSynth.speaking = queued.size > 0;
      if (type === 'end') u.onend?.();
      else u.onerror?.({ error: 'synthesis-failed' });
    }
  };
}
