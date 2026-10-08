// @ts-check
// Audio reading (phone): the device's own text-to-speech engine through the Web Speech API
// (on Android — Google TTS, RHVoice or whatever is chosen in the system settings).
//
// The reader marks what can be read: `data-tts="ru|en"` on the titles and paragraph texts, with
// `data-tts-key` shared by both languages (paragraph ref, or "h<section>" for a title). Only that
// plain text is spoken — no paragraph or page numbers. A translation variant shown in place of the
// text (`.tr-sub`) is read as shown. Text goes sentence by sentence: the sentence being read is
// highlighted, the reader scrolls after it, and pause/resume or a change of voice restart it.

import { setRanges, clearHighlights, rangeFor } from './highlight.js';
import { holdChrome } from './mobile.svelte.js';
import { showToast } from './toast.svelte.js';
import { sentences } from './sentences.js';
import { api } from './api.js';
import { navigate } from './router.svelte.js';
import { bgStart, bgStop, bgMeta } from './background.js';
import { applyDict, loadDict } from './pronunciations.svelte.js';

const PREFS_KEY = 'ub.tts';
/**
 * The voice of one language: each language keeps its own (voices differ between devices, so these
 * are settings of the device, not of the workspace).
 * @typedef {{ volume: number, pitch: number, rate: number, voice: string }} Voice
 */
/** @type {Record<'ru' | 'en', Voice>} */
export const VOICE_DEFAULTS = {
  ru: { volume: 1, pitch: 0.7, rate: 1.1, voice: '' },
  en: { volume: 1, pitch: 1, rate: 1, voice: '' },
};

function readPrefs() {
  /** @type {any} */
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
  } catch {}
  return {
    lang: /** @type {'ru' | 'en'} */ (p.lang === 'en' ? 'en' : 'ru'),
    ru: { ...VOICE_DEFAULTS.ru, ...(typeof p.ru === 'object' ? p.ru : {}) },
    en: { ...VOICE_DEFAULTS.en, ...(typeof p.en === 'object' ? p.en : {}) },
  };
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: tts.lang, ru: tts.ru, en: tts.en }));
  } catch {}
}

const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

export const tts = $state({
  supported: synth !== null,
  /** The player panel is shown. */
  open: false,
  playing: false,
  settingsOpen: false,
  /** Voices of the engine: name, language, online (the browser's network voices). @type {{ name: string, lang: string, online: boolean }[]} */
  voices: [],
  /** The last place read and the share of the book before it (0…1). @type {{ paper: number, key: string, s: number, progress: number } | null} */
  place: null,
  ...readPrefs(),
});

function loadVoices() {
  if (synth) tts.voices = synth.getVoices().map((v) => ({ name: v.name, lang: v.lang, online: !v.localService }));
}
synth?.addEventListener('voiceschanged', loadVoices);
loadVoices();

/** @param {'ru' | 'en'} lang */
export function setLang(lang) {
  tts.lang = lang;
  savePrefs();
  if (pos) pos = { key: pos.key, s: 0 }; // the same paragraph in the other language
  if (tts.playing) speakSoon(0);
  else showPosition();
}

/** A setting of the current language's voice. @template {keyof Voice} K @param {K} key @param {Voice[K]} value */
export function setVoice(key, value) {
  tts[tts.lang][key] = value;
  savePrefs();
  if (tts.playing) speakSoon(350); // a new rate or voice is heard at once
}

/** @param {'ru' | 'en'} lang */
export const voicesFor = (lang) => tts.voices.filter((v) => v.lang.toLowerCase().startsWith(lang));

// ---- The reader the text comes from ----

/** @type {{ article: () => HTMLElement | null, scroller: () => HTMLElement | null, paper: () => number | null, next: () => boolean } | null} */
let host = null;

// ---- Progress through the whole book and the last place read (remembered on this device) ----
const PLACE_KEY = 'ub.ttsPlace';
/** @typedef {{ paper: number, key: string, s: number, progress: number }} Place */
/** @returns {Place | null} */
function readPlace() {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
    return p && typeof p.key === 'string' && Number.isInteger(p.paper) ? p : null;
  } catch {
    return null;
  }
}
tts.place = readPlace();
/**
 * Paragraphs before each paper and in the whole book (from the contents); `papers` in book order.
 * @type {{ before: Map<number, number>, total: number, papers: { id: number, count: number }[] } | null}
 */
let book = null;
let bookLoading = false;
function loadBook() {
  if (book || bookLoading) return;
  bookLoading = true;
  api.toc().then(
    (t) => {
      const before = new Map();
      let total = 0;
      for (const p of t.papers) {
        before.set(p.id, total);
        total += p.paragraphs ?? 0;
      }
      book = { before, total, papers: t.papers.map((p) => ({ id: p.id, count: p.paragraphs ?? 0 })) };
    },
    () => (bookLoading = false),
  );
}
/** Saves where reading is and how far through the book that is. */
function remember() {
  const c = current();
  const paper = host?.paper();
  if (!c || !pos || paper == null) return;
  // paragraph keys are refs ("5:1.3"); titles ("h2") do not count
  const before = c.list.slice(0, c.i).filter((el) => (el.dataset.ttsKey ?? '').includes(':')).length;
  const inPara = c.block.sentences.length ? c.s / c.block.sentences.length : 0;
  const progress = book && book.total ? Math.min(1, ((book.before.get(paper) ?? 0) + before + inPara) / book.total) : (tts.place?.progress ?? 0);
  tts.place = { paper, key: pos.key, s: pos.s, progress };
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(tts.place));
  } catch {}
}
/** The reader registers itself while it is on screen. @param {NonNullable<typeof host>} h */
export function registerReader(h) {
  host = h;
  const box = h.scroller();
  const touched = () => (userAt = Date.now());
  box?.addEventListener('touchstart', touched, { passive: true });
  box?.addEventListener('wheel', touched, { passive: true });
  return () => {
    if (host === h) host = null;
    box?.removeEventListener('touchstart', touched);
    box?.removeEventListener('wheel', touched);
    stop();
  };
}

/** Where reading is: the block (paragraph or title) and the sentence in it. @type {{ key: string, s: number } | null} */
let pos = null;
/** The reader scrolled by hand recently: do not pull the text away from them. */
let userAt = 0;
/** At the end of a paper the next one is opened and reading continues there. */
let continueNext = false;

const elements = () => /** @type {HTMLElement[]} */ ([...(host?.article()?.querySelectorAll(`[data-tts="${tts.lang}"]`) ?? [])]);

/**
 * The spoken text of an element and the map from its offsets to DOM text offsets
 * (a variant in place of the text is spoken as `data-text`, while the DOM holds the original).
 * @param {Element} el
 */
function readable(el) {
  let text = '';
  let dom = 0;
  /** @type {{ t0: number, t1: number, d0: number, d1: number, sub: boolean }[]} */
  const segs = [];
  /** @param {Node} node */
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === Node.TEXT_NODE) {
        const s = /** @type {Text} */ (ch).data;
        segs.push({ t0: text.length, t1: text.length + s.length, d0: dom, d1: dom + s.length, sub: false });
        text += s;
        dom += s.length;
      } else if (ch instanceof HTMLElement && ch.classList.contains('tr-sub')) {
        const s = ch.dataset.text ?? '';
        const len = ch.textContent?.length ?? 0;
        segs.push({ t0: text.length, t1: text.length + s.length, d0: dom, d1: dom + len, sub: true });
        text += s;
        dom += len;
      } else if (ch.nodeType === Node.ELEMENT_NODE) walk(ch);
    }
  };
  walk(el);
  /** @param {number} o @param {boolean} end */
  const toDom = (o, end) => {
    const g = segs.find((x) => o >= x.t0 && o <= x.t1 && (end ? o > x.t0 || x.t0 === x.t1 : o < x.t1)) ?? segs.at(-1);
    if (!g) return 0;
    return g.sub ? (end ? g.d1 : g.d0) : g.d0 + (o - g.t0);
  };
  return { text, toDom, sentences: sentences(text) };
}

/** The current block and sentence, resolved against the DOM as it is now. */
function current() {
  if (!pos) return null;
  const key = pos.key;
  const list = elements();
  const i = list.findIndex((el) => el.dataset.ttsKey === key);
  if (i < 0) return null;
  const block = readable(list[i]);
  if (!block.sentences.length) return { list, i, el: list[i], block, s: 0, a: 0, b: 0 };
  const s = Math.min(pos.s, block.sentences.length - 1);
  const [a, b] = block.sentences[s];
  return { list, i, el: list[i], block, s, a, b };
}

/** The first block on screen (below the header). */
function firstVisible() {
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8;
  const el = elements().find((e) => e.getBoundingClientRect().bottom > top);
  return el ? { key: el.dataset.ttsKey ?? '', s: 0 } : null;
}

/** Highlights the sentence and keeps it in view between the header and the player. */
function showPosition() {
  const c = current();
  if (!c) {
    clearHighlights('tts');
    return;
  }
  const r = rangeFor(c.el, c.block.toDom(c.a, false), c.block.toDom(c.b, true));
  setRanges('tts', r ? [r] : [], 4);
  remember();
  const said = c.block.text.slice(c.a, c.b).replace(/\s+/g, ' ').trim();
  bgMeta(said.length > 70 ? said.slice(0, 70) + '…' : said, `Текст ${host?.paper() ?? ''}`);
  const box = host?.scroller();
  if (!r || !box || Date.now() - userAt < 5000) return;
  const rect = r.getBoundingClientRect();
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8;
  const bottom = (document.querySelector('.tts-panel')?.getBoundingClientRect().top ?? innerHeight) - 8;
  if (rect.top < top || rect.bottom > bottom) {
    holdChrome();
    box.scrollBy({ top: rect.top - (top + (bottom - top) * 0.2), behavior: 'smooth' });
  }
}

/** Moves by sentences; false at the end (start) of the paper. @param {1 | -1} dir */
function step(dir) {
  const c = current();
  if (!c) return false;
  const n = c.block.sentences.length;
  if (dir > 0 && c.s + 1 < n) pos = { key: c.el.dataset.ttsKey ?? '', s: c.s + 1 };
  else if (dir < 0 && c.s > 0) pos = { key: c.el.dataset.ttsKey ?? '', s: c.s - 1 };
  else {
    const el = c.list[c.i + dir];
    if (!el) return false;
    pos = { key: el.dataset.ttsKey ?? '', s: dir > 0 ? 0 : Math.max(0, readable(el).sentences.length - 1) };
  }
  return true;
}

let run = 0;
let timer = 0;
/** @param {number} delay */
function speakSoon(delay) {
  clearTimeout(timer);
  timer = window.setTimeout(speak, delay);
}

/** An utterance in the current language with its voice settings. @param {string} text */
function utterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tts.lang === 'ru' ? 'ru-RU' : 'en-US';
  const prefs = tts[tts.lang];
  const voice = prefs.voice ? synth?.getVoices().find((v) => v.name === prefs.voice) : undefined;
  if (voice) u.voice = voice;
  u.rate = prefs.rate;
  u.pitch = prefs.pitch;
  u.volume = prefs.volume;
  return u;
}

/** Says a sample (settings, the pronunciation dictionary); stops reading first. @param {string} text */
export function sayOnce(text) {
  if (!synth || !text.trim()) return;
  if (tts.playing) pause();
  synth.cancel();
  synth.speak(utterance(text));
}

function speak() {
  if (!synth) return;
  const my = ++run;
  synth.cancel();
  const c = current();
  if (!c) return stop();
  showPosition();
  const text = c.block.text.slice(c.a, c.b).replace(/\s+/g, ' ').trim();
  if (!text) return void (step(1) ? speakSoon(0) : endOfPaper());
  const u = utterance(applyDict(text, tts.lang)); // the highlight shows the text, the voice gets the dictionary's spelling
  u.onend = () => {
    if (my !== run || !tts.playing) return;
    if (step(1)) speak();
    else endOfPaper();
  };
  u.onerror = (e) => {
    if (my !== run || e.error === 'interrupted' || e.error === 'canceled') return;
    pause();
    showToast(e.error === 'language-unavailable' || e.error === 'voice-unavailable'
      ? 'Нет голоса для этого языка: установите его в настройках синтеза речи Android'
      : `Синтез речи остановился: ${e.error}`);
  };
  // Chrome may drop an utterance queued right after cancel(): a short pause avoids it.
  window.setTimeout(() => my === run && synth.speak(u), 60);
}

function endOfPaper() {
  if (host?.next()) continueNext = true;
  else {
    pause();
    showToast('Конец книги');
  }
}

/** Called by the reader when a paper has been rendered. */
export function paperReady() {
  if (resumeTo) {
    const t = resumeTo;
    resumeTo = null;
    if (host?.paper() === t.paper) {
      pos = { key: t.key, s: t.s };
      setTimeout(start, 300); // after the reader's own scroll to the paragraph
    }
  } else if (seekTarget) {
    const t = seekTarget;
    seekTarget = null;
    if (host?.paper() === t.paper) setTimeout(() => applySeek(t), 300); // after the reader's own scroll
  } else if (continueNext) {
    continueNext = false;
    pos = elements()[0] ? { key: elements()[0].dataset.ttsKey ?? '', s: 0 } : null;
    if (tts.playing) speakSoon(0);
  } else if (pos && !current()) {
    // The reader went elsewhere: start from what is on screen next time.
    pause();
    pos = null;
    clearHighlights('tts');
  }
}

// ---- Keeping the screen on while reading (the engine may stop when the screen goes off) ----
/** @type {WakeLockSentinel | null} */
let wake = null;
async function keepAwake() {
  try {
    if (!wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => (wake = null));
    }
  } catch {}
}
// Chrome on Android stops speech as soon as the page is hidden (another app, the shade…). Back in
// the app, reading goes on from the same sentence.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !tts.playing || !synth) return;
  void keepAwake();
  if (synth.paused) synth.resume();
  setTimeout(() => {
    if (tts.playing && !synth.speaking && !synth.pending) speakSoon(0);
  }, 400);
});

// ---- Commands ----

// ---- Sessions: "what I see is what I hear" ----
// A session lasts from opening the player ("Слушать") to ■. Its start point is the place where the
// voice first started in it; a long press on ▶ goes back there. Otherwise ▶ follows the eyes: it
// continues the paused sentence while that is on screen, else starts from the first sentence on screen.

/** @type {{ paper: number, key: string, s: number } | null} */
let session = null;
/** A paper being opened to read from a place in it. @type {{ paper: number, key: string, s: number } | null} */
let resumeTo = null;

/** The visible text between the header and the player. */
function viewport() {
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 4;
  const bottom = (document.querySelector('.tts-panel')?.getBoundingClientRect().top ?? innerHeight) - 4;
  return { top, bottom };
}

/** Is the paused sentence on screen? */
function currentOnScreen() {
  const c = current();
  if (!c) return false;
  const r = rangeFor(c.el, c.block.toDom(c.a, false), c.block.toDom(c.b, true))?.getBoundingClientRect();
  const v = viewport();
  return !!r && r.bottom > v.top && r.top < v.bottom;
}

/** The first sentence that starts on screen (or, failing that, the first block on screen). */
function firstOnScreen() {
  const { top } = viewport();
  for (const el of elements()) {
    if (el.getBoundingClientRect().bottom <= top) continue;
    const block = readable(el);
    const s = block.sentences.findIndex(([a, b]) => (rangeFor(el, block.toDom(a, false), block.toDom(b, true))?.getBoundingClientRect().top ?? -1) >= top);
    if (s >= 0) return { key: el.dataset.ttsKey ?? '', s };
  }
  return firstVisible();
}

/** Starts the voice at `pos` (and fixes the session's start point if this is its first start). */
function start() {
  if (!pos || !host) return;
  void loadDict();
  const paper = host.paper();
  if (!session && paper != null) session = { paper, key: pos.key, s: pos.s };
  tts.playing = true;
  userAt = 0;
  void keepAwake();
  bgStart({ play, pause, next: () => paragraph(1), prev: () => paragraph(-1) });
  speakSoon(0);
}

/** ▶: what I see is what I hear — the paused sentence if it is on screen, else the screen's first sentence. */
export function play() {
  if (!synth) return showToast('Этот браузер не умеет синтезировать речь');
  if (!host) return;
  if (!pos || !currentOnScreen()) pos = firstOnScreen();
  start();
}

export function pause() {
  tts.playing = false;
  run++;
  clearTimeout(timer);
  synth?.cancel();
  bgStop();
  void wake?.release();
}

export function toggle() {
  if (tts.playing) pause();
  else play();
}

/** Stops and closes the player: the session ends. */
export function stop() {
  pause();
  pos = null;
  session = null;
  resumeTo = null;
  continueNext = false;
  tts.open = false;
  tts.settingsOpen = false;
  clearHighlights('tts');
}

/**
 * The desktop's "Слушать" (no player there, for now): reads from the first sentence on screen;
 * again — stops.
 */
export function toggleDesktop() {
  if (tts.playing) return stop();
  tts.open = true;
  pos = null;
  session = null;
  play();
}

/** "Слушать": opens the player — a new session; the book stays where it is. */
export function openPlayer() {
  tts.open = true;
  session = null;
  loadBook();
}

/** Long press on ▶: back to where this session started (opening that paper if needed). */
export function playFromSessionStart() {
  if (!synth || !host) return;
  const s = session;
  if (!s) return play(); // nothing played yet in this session: as ▶
  showToast(`С начала сессии · ${s.key.includes(':') ? s.key : `Текст ${s.paper}`}`);
  if (host.paper() === s.paper && elements().some((e) => e.dataset.ttsKey === s.key)) {
    pos = { key: s.key, s: s.s };
    start();
  } else {
    pause();
    resumeTo = s;
    navigate(s.key.includes(":") ? `/${s.key}` : `/${s.paper}`, { replace: true }); // the app moves, not the reader: no history entry
  }
}

// ---- Seeking along the whole book (the progress line) ----

/** The paper and its paragraph at a share of the book. @param {number} frac */
export function locate(frac) {
  if (!book || !book.total) return null;
  const g = Math.min(book.total - 1, Math.max(0, Math.floor(frac * book.total)));
  for (const p of book.papers) {
    const before = book.before.get(p.id) ?? 0;
    if (g < before + p.count) return { paper: p.id, idx: g - before };
  }
  return null;
}

/** @type {{ paper: number, idx: number, play: boolean } | null} */
let seekTarget = null;
/** @param {{ paper: number, idx: number, play: boolean }} t */
function applySeek(t) {
  const paras = elements().filter((el) => (el.dataset.ttsKey ?? '').includes(':'));
  const el = paras[Math.min(t.idx, paras.length - 1)];
  if (!el) return;
  pos = { key: el.dataset.ttsKey ?? '', s: 0 };
  userAt = 0;
  if (t.play) {
    tts.playing = true;
    speakSoon(0);
  } else showPosition();
}

/** Moves reading to a share of the book: within this paper at once, otherwise the paper is opened. @param {number} frac */
export function seek(frac) {
  const t = locate(frac);
  if (!t || !host) return;
  const target = { ...t, play: tts.playing };
  if (tts.playing) {
    run++;
    clearTimeout(timer);
    synth?.cancel();
  }
  if (host.paper() === t.paper) applySeek(target);
  else {
    seekTarget = target;
    navigate(`/${t.paper}`, { replace: true });
  }
}

/** Contents loaded: the progress line can seek. */
export const canSeek = () => book !== null;

/** @param {1 | -1} dir */
export function sentence(dir) {
  if (!pos) pos = firstOnScreen();
  else step(dir);
  userAt = 0;
  if (tts.playing) speakSoon(0);
  else showPosition();
}

/** Next paragraph, or the start of this one (then the previous) backwards. @param {1 | -1} dir */
export function paragraph(dir) {
  const c = current();
  if (!c) return sentence(dir);
  if (dir < 0 && c.s > 0) pos = { key: c.el.dataset.ttsKey ?? '', s: 0 };
  else {
    const el = c.list[c.i + dir];
    if (!el) return;
    pos = { key: el.dataset.ttsKey ?? '', s: 0 };
  }
  userAt = 0;
  if (tts.playing) speakSoon(0);
  else showPosition();
}
