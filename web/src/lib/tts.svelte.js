// @ts-check
// Audio reading (phone): the device's own text-to-speech engine through the Web Speech API
// (on Android — Google TTS, RHVoice or whatever is chosen in the system settings). In the Android
// app (native.js) the same engine is reached through the app, and reading goes on with the screen
// off: the sentences up to the end of the paper are queued at once and the engine reads them itself.
//
// The reader marks what can be read: `data-tts="ru|en"` on the titles and paragraph texts, with
// `data-tts-key` shared by both languages (paragraph ref, or "h<section>" for a title). Only that
// plain text is spoken — no paragraph or page numbers. A translation variant shown in place of the
// text (`.tr-sub`) is read as shown. Text goes sentence by sentence: the sentence being read is
// highlighted, the reader scrolls after it, and pause/resume or a change of voice restart it.
//
// Or a recording ("Запись"): a language whose voice is set to it is heard from the recorded files, a
// file per section of a paper. The paragraph being heard is highlighted — where it starts in the file is
// estimated from the lengths of the section's texts (the recording reads the same paragraphs).

import { setRanges, clearHighlights, rangeFor } from './highlight.js';
import { holdChrome } from './mobile.svelte.js';
import { showToast } from './toast.svelte.js';
import { sentences } from './sentences.js';
import { api } from './api.js';
import { navigate } from './router.svelte.js';
import { bgStart, bgStop, bgEnd, bgMeta } from './background.js';
import { native, nativeSynth, NativeUtterance } from './native.js';
import { log } from './log.js';
import { listened } from './recordings.svelte.js';
import { applyDict, loadDict } from './pronunciations.svelte.js';
import { noteListen, setListenHandler } from './places.svelte.js';

const PREFS_KEY = 'ub.tts';
/**
 * The voice of one language: each language keeps its own (voices differ between devices, so these
 * are settings of the device, not of the workspace). `source`: the device's speech synthesis or the
 * recording (its own speed, `audioRate`: a voice's rate and a recording's differ).
 * @typedef {{ volume: number, pitch: number, rate: number, voice: string, source: 'tts' | 'audio', audioRate: number }} Voice
 */
/** @type {Record<'ru' | 'en', Voice>} */
export const VOICE_DEFAULTS = {
  ru: { volume: 1, pitch: 0.7, rate: 1.1, voice: '', source: 'tts', audioRate: 1 },
  en: { volume: 1, pitch: 1, rate: 1, voice: '', source: 'tts', audioRate: 1 },
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

/** @type {SpeechSynthesis | null} */
const synth = nativeSynth ? /** @type {any} */ (nativeSynth) : typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

export const tts = $state({
  supported: synth !== null,
  /** The player panel is shown. */
  open: false,
  playing: false,
  settingsOpen: false,
  /**
   * Voices of the engine: id (voiceURI — names repeat: iOS has "Eddy", "Flo"… in every English
   * region), the name shown (with the region when the name repeats), language, online (network voices).
   * `engine`: whose voice it is, in the Android app ("Google", "Huawei"…; '' in a browser).
   * @type {{ id: string, name: string, lang: string, online: boolean, engine: string }[]}
   */
  voices: [],
  /** The last place read and the share of the book before it (0…1). @type {{ paper: number, key: string, s: number, progress: number, file?: string | null, t?: number | null } | null} */
  place: null,
  /** Languages that have a recording (the player offers "Запись" for them). @type {('ru' | 'en')[]} */
  recorded: [],
  /**
   * The recording's file being heard (or paused): the progress line shows it and moves along it.
   * @type {{ paper: number, sections: number[], file: string, time: number, duration: number } | null}
   */
  track: null,
  ...readPrefs(),
});

function loadVoices() {
  if (!synth) return;
  const all = synth.getVoices();
  const seen = new Set();
  const list = all.filter((v) => !seen.has(v.voiceURI || v.name) && seen.add(v.voiceURI || v.name));
  /** @param {SpeechSynthesisVoice} v */
  const repeats = (v) => list.some((x) => x !== v && x.name === v.name && x.lang !== v.lang);
  tts.voices = list.map((v) => ({
    id: v.voiceURI || v.name,
    name: repeats(v) ? `${v.name} (${v.lang})` : v.name,
    lang: v.lang,
    online: !v.localService,
    engine: /** @type {any} */ (v).engine ?? '',
  }));
  // a voice chosen before is kept by its name: now by its id
  for (const lang of /** @type {const} */ (['ru', 'en'])) {
    const pref = tts[lang].voice;
    if (pref && !all.some((v) => v.voiceURI === pref)) {
      const v = all.find((x) => x.name === pref && x.lang.toLowerCase().startsWith(lang));
      if (v?.voiceURI) tts[lang].voice = v.voiceURI;
    }
  }
}
/** The engine's voice by its id (or by the name a voice was kept under before). @param {string} id */
const voiceById = (id) => synth?.getVoices().find((v) => v.voiceURI === id) ?? synth?.getVoices().find((v) => v.name === id);
synth?.addEventListener('voiceschanged', loadVoices);
loadVoices();

/** @param {'ru' | 'en'} lang */
export function setLang(lang) {
  // The English text opens (reading English) or folds (Russian) above the screen: the browser shifts the
  // scroll by that height, and the header must not take it for the reader's own scrolling.
  holdChrome(1500, false);
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
  if (heard === 'audio' && player && (key === 'volume' || key === 'audioRate')) return tuneRecording(); // (no restart)
  if (key === 'source') {
    if (tts.playing) {
      run++;
      silence();
      speakSoon(0); // the same paragraph, in the other voice
    } else {
      if (value !== 'audio') (heard = 'tts'), (tts.track = null);
      showPosition();
    }
    return;
  }
  if (tts.playing && heard === 'tts') speakSoon(350); // a new rate or voice is heard at once
}

/** @param {'ru' | 'en'} lang */
export const voicesFor = (lang) => tts.voices.filter((v) => v.lang.toLowerCase().startsWith(lang));

// ---- The reader the text comes from ----

/** @type {{ article: () => HTMLElement | null, scroller: () => HTMLElement | null, paper: () => number | null, next: () => boolean } | null} */
let host = null;

// ---- Progress through the whole book and the last place read (remembered on this device) ----
const PLACE_KEY = 'ub.ttsPlace';
/** `file`, `t`: heard from a recording — its file and the second in it. @typedef {{ paper: number, key: string, s: number, progress: number, file?: string | null, t?: number | null }} Place */
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
/** The paragraph map of the book is loaded (the reading progress line waits for it). */
export const bookMap = $state({ ready: false });
export function loadBook() {
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
      bookMap.ready = true;
    },
    () => (bookLoading = false),
  );
}
/** Share of the book before paragraph `idx` (fractional) of `paper`, or null until the map is loaded. @param {number} paper @param {number} idx */
export function bookShare(paper, idx) {
  if (!book || !book.total) return null;
  return Math.min(1, Math.max(0, ((book.before.get(paper) ?? 0) + idx) / book.total));
}
/** Saves where reading is and how far through the book that is. */
function remember(heardShare = 0) {
  const c = current();
  const paper = host?.paper();
  if (!c || !pos || paper == null) return;
  // paragraph keys are refs ("5:1.3"); titles ("h2") do not count
  const before = c.list.slice(0, c.i).filter((el) => (el.dataset.ttsKey ?? '').includes(':')).length;
  const inPara = heard === 'audio' ? heardShare : c.block.sentences.length ? c.s / c.block.sentences.length : 0;
  const progress = book && book.total ? Math.min(1, ((book.before.get(paper) ?? 0) + before + inPara) / book.total) : (tts.place?.progress ?? 0);
  const rec = heard === 'audio' && player && playing ? recordingFor(pos.key) : null;
  const file = rec ? rec.file : null;
  const t = rec && player && Number.isFinite(player.currentTime) ? Math.round(player.currentTime * 10) / 10 : null;
  tts.place = { paper, key: pos.key, s: pos.s, progress, file, t };
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(tts.place));
  } catch {}
  noteListen({ paper, key: pos.key, s: pos.s, lang: tts.lang, progress, file, t });
}
// A newer place from another device: the progress line shows it.
setListenHandler((p) => {
  tts.place = { paper: p.paper, key: p.key, s: p.s, progress: p.progress ?? tts.place?.progress ?? 0, file: p.file ?? null, t: p.t ?? null };
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(tts.place));
  } catch {}
});
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
  // a recording: the whole paragraph (where its sentences fall in the file is not known)
  const whole = heard === 'audio' && recordingFor(c.el.dataset.ttsKey ?? '') !== null;
  const r = whole ? rangeFor(c.el, 0, c.block.toDom(c.block.text.length, true)) : rangeFor(c.el, c.block.toDom(c.a, false), c.block.toDom(c.b, true));
  setRanges('tts', r ? [r] : [], 4);
  remember();
  const said = (whole ? c.block.text.slice(0, 200) : c.block.text.slice(c.a, c.b)).replace(/\s+/g, ' ').trim();
  bgMeta(said.length > 70 ? said.slice(0, 70) + '…' : said, `Текст ${host?.paper() ?? ''}`);
  const box = host?.scroller();
  if (!r || !box || Date.now() - userAt < 5000) return;
  const rect = r.getBoundingClientRect();
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8;
  const bottom = (document.querySelector('.tts-panel')?.getBoundingClientRect().top ?? innerHeight) - 8;
  // a recording: the paragraph heard starts in the upper half (it is heard for a while, the eyes follow it)
  const away = whole ? rect.top < top || rect.top > top + (bottom - top) * 0.5 : rect.top < top || rect.bottom > bottom;
  if (away) {
    holdChrome(900, false); // (the voice scrolls the text: the header stays as the reader left it)
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
  /** @type {SpeechSynthesisUtterance} */
  const u = native ? /** @type {any} */ (new NativeUtterance(text)) : new SpeechSynthesisUtterance(text);
  u.lang = tts.lang === 'ru' ? 'ru-RU' : 'en-US';
  const prefs = tts[tts.lang];
  const voice = prefs.voice ? voiceById(prefs.voice) : undefined;
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
  const c0 = current();
  if (c0 && wantsRecording() && recordingFor(c0.el.dataset.ttsKey ?? '')) return hear();
  if (!synth) return;
  const my = ++run;
  if (heard === 'audio') player?.pause();
  heard = 'tts';
  tts.track = null;
  synth.cancel();
  const c = current();
  if (!c) return stop();
  showPosition();
  if (native) return speakAhead(c, my);
  const text = c.block.text.slice(c.a, c.b).replace(/\s+/g, ' ').trim();
  if (!text) return void (step(1) ? speakSoon(0) : endOfPaper());
  const u = utterance(applyDict(text, tts.lang)); // the highlight shows the text, the voice gets the dictionary's spelling
  u.onend = () => {
    if (my !== run || !tts.playing) return;
    // one paragraph asked for (its ▶ in the text): it ends with its last sentence
    if (onlyKey !== null && onlyKey === c.el.dataset.ttsKey && c.s >= c.block.sentences.length - 1) {
      onlyKey = null;
      return pause();
    }
    if (step(1)) speak();
    else endOfPaper();
  };
  u.onerror = failed(my);
  // Chrome may drop an utterance queued right after cancel(): a short pause avoids it.
  window.setTimeout(() => my === run && synth.speak(u), 60);
}

/** The engine could not read (an interruption by the page itself is not a failure). @param {number} my */
const failed = (my) => /** @param {{ error: string }} e */ (e) => {
  if (my !== run || e.error === 'interrupted' || e.error === 'canceled') return;
  log('tts', 'движок речи остановился', { error: e.error, at: pos?.key, voice: tts[tts.lang].voice || 'системный' }, 'error');
  pause();
  showToast(e.error === 'language-unavailable' || e.error === 'voice-unavailable'
    ? 'Нет голоса для этого языка: установите его в настройках синтеза речи Android'
    : `Синтез речи остановился: ${e.error}`);
};

/**
 * The Android app: the sentences from here to the end of the paper (or of the one paragraph asked
 * for) go to the engine at once, and it reads them by itself — with the screen off too, when the
 * page's timers sleep. Each sentence, as it starts, moves the highlight and the place read.
 * @param {NonNullable<ReturnType<typeof current>>} c @param {number} my
 */
function speakAhead(c, my) {
  if (!synth) return;
  const only = onlyKey !== null && onlyKey === c.el.dataset.ttsKey ? onlyKey : null;
  /** @type {{ key: string, s: number, text: string }[]} */
  const queue = [];
  for (let i = c.i; i < c.list.length && (only === null || i === c.i); i++) {
    const el = c.list[i];
    const block = i === c.i ? c.block : readable(el);
    block.sentences.forEach(([a, b], s) => {
      const text = block.text.slice(a, b).replace(/\s+/g, ' ').trim();
      if (text && (i > c.i || s >= c.s)) queue.push({ key: el.dataset.ttsKey ?? '', s, text });
    });
  }
  const done = () => {
    if (my !== run || !tts.playing) return;
    if (only !== null) {
      onlyKey = null;
      return pause();
    }
    endOfPaper();
  };
  if (!queue.length) return done();
  queue.forEach((q, n) => {
    const u = utterance(applyDict(q.text, tts.lang));
    u.onstart = () => {
      if (my !== run) return;
      pos = { key: q.key, s: q.s };
      showPosition();
    };
    if (n === queue.length - 1) u.onend = done;
    u.onerror = failed(my);
    synth.speak(u);
  });
}

function endOfPaper() {
  log('tts', 'конец Текста', { paper: host?.paper(), hidden: document.visibilityState === 'hidden' });
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
      resumeExact = true;
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
  if (native) return; // (the app reads with the screen off)
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
  if (document.visibilityState !== 'visible' || !tts.playing || !synth || native || heard === 'audio') return;
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

let unlocked = false;
/** Starts the voice at `pos` (and fixes the session's start point if this is its first start). */
function start() {
  if (!pos || !host) return;
  log('tts', 'чтение', { at: pos.key, lang: tts.lang, source: tts[tts.lang].source, voice: tts[tts.lang].voice || 'системный', app: !!native });
  void loadDict();
  const paper = host.paper();
  if (!session && paper != null) session = { paper, key: pos.key, s: pos.s };
  tts.playing = true;
  userAt = 0;
  // Safari (iOS) lets a page speak only after it has spoken within a tap; the reading itself starts a
  // moment later (a timer), so an empty utterance is said now, still within the tap.
  if (!unlocked && synth && !native) {
    synth.speak(new SpeechSynthesisUtterance(''));
    unlocked = true;
  }
  void keepAwake();
  const rec = wantsRecording() && recordingFor(pos.key) !== null;
  bgStart({ play, pause, next: () => paragraph(1), prev: () => paragraph(-1), close: stop, seek: rec ? (sec) => skip(sec) : undefined }, !rec);
  // a recording starts now, still within the tap (Safari lets a page play sound only then)
  if (rec) speak();
  else speakSoon(0);
}

/** ▶: what I see is what I hear — the paused sentence if it is on screen, else the screen's first sentence. */
export function play() {
  onlyKey = null; // the player's own ▶ reads on
  resumeExact = true; // (a recording: from the remembered second, if it is this paragraph)
  if (!synth && !wantsRecording()) return showToast('Этот браузер не умеет синтезировать речь');
  if (!host) return;
  if (!pos || !currentOnScreen()) pos = firstOnScreen();
  start();
}

export function pause() {
  if (tts.playing) log('tts', 'пауза', { at: pos?.key, hidden: document.visibilityState === 'hidden' });
  tts.playing = false;
  run++;
  clearTimeout(timer);
  silence();
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
  bgEnd();
  pos = null;
  session = null;
  resumeTo = null;
  continueNext = false;
  tts.open = false;
  tts.settingsOpen = false;
  clearHighlights('tts');
  if (player && playing) {
    player.removeAttribute('src'); // (no more loading of a file nobody listens to)
    player.load();
    playing = null;
  }
  heard = 'tts';
  tts.track = null;
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

/** The paragraph asked for by its ▶ in the text: reading stops at its end (null — reading goes on). @type {string | null} */
let onlyKey = null;

/**
 * ▶ by a paragraph (or its comparison text): this paragraph in this language, with the player's voice;
 * the player opens in that language and stops at the paragraph's end (its ▶ goes on from there).
 * Again on the paragraph being read — stops. @param {string} ref @param {'ru' | 'en'} lang
 */
export function playParagraph(ref, lang) {
  if (!host) return;
  if (paragraphPlaying(ref, lang)) return pause();
  if (!synth && !(tts[lang].source === 'audio' && tts.recorded.includes(lang))) return showToast('Этот браузер не умеет синтезировать речь');
  if (!tts.open) openPlayer();
  if (tts.lang !== lang) {
    tts.lang = lang;
    savePrefs();
  }
  pos = { key: ref, s: 0 };
  // a recording plays on until ■: where its paragraphs end is only estimated, and stopping at the
  // estimate cut the paragraph's last words
  onlyKey = wantsRecording() && recordingFor(ref) ? null : ref;
  if (tts.playing) {
    run++;
    clearTimeout(timer);
    silence();
  }
  start();
}

/** This paragraph in this language is being read now (its ▶ shows ■). @param {string} ref @param {'ru' | 'en'} lang */
export const paragraphPlaying = (ref, lang) => tts.playing && tts.lang === lang && tts.place?.key === ref;

/** "Слушать": opens the player — a new session; the book stays where it is. */
export function openPlayer() {
  tts.open = true;
  session = null;
  loadBook();
  loadRecordings();
}

/** Long press on ▶: back to where this session started (opening that paper if needed). */
export function playFromSessionStart() {
  if ((!synth && !wantsRecording()) || !host) return;
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

/** A paragraph by its number in the paper (the progress line) or an exact place ("Вернуться"). @typedef {{ paper: number, idx?: number, key?: string, s?: number, play: boolean }} SeekTarget */
/** @type {SeekTarget | null} */
let seekTarget = null;
/** @param {SeekTarget} t */
function applySeek(t) {
  if (t.key) pos = { key: t.key, s: t.s ?? 0 };
  else {
    const paras = elements().filter((el) => (el.dataset.ttsKey ?? '').includes(':'));
    const el = paras[Math.min(t.idx ?? 0, paras.length - 1)];
    if (!el) return;
    pos = { key: el.dataset.ttsKey ?? '', s: 0 };
  }
  userAt = 0;
  if (t.play) {
    tts.playing = true;
    speakSoon(0);
  } else showPosition();
}

/** @param {SeekTarget} target */
function goTo(target) {
  if (!host) return;
  if (tts.playing) {
    run++;
    clearTimeout(timer);
    silence();
  }
  if (host.paper() === target.paper && (!target.key || elements().some((e) => e.dataset.ttsKey === target.key))) applySeek(target);
  else {
    seekTarget = target;
    navigate(target.key?.includes(':') ? `/${target.key}` : `/${target.paper}`, { replace: true });
  }
}

/**
 * Moves reading to a share of the book: within this paper at once, otherwise the paper is opened.
 * Returns where reading was (for "Вернуться"). @param {number} frac
 */
export function seek(frac) {
  const t = locate(frac);
  if (!t || !host) return null;
  const paper = host.paper();
  const was = pos && paper != null ? { paper, key: pos.key, s: pos.s } : tts.place && { paper: tts.place.paper, key: tts.place.key, s: tts.place.s };
  goTo({ ...t, play: tts.playing });
  return was;
}

/** Back to where reading was before a seek. @param {{ paper: number, key: string, s: number }} place */
export function seekBack(place) {
  goTo({ ...place, play: tts.playing });
}

/** Contents loaded: the progress line can seek. */
export const canSeek = () => book !== null;

/** @param {1 | -1} dir */
export function sentence(dir) {
  if (heard === 'audio' && playing) return skip(dir * SKIP);
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
  if (dir < 0 && heard === 'audio' && tts.playing && intoBlock() > 3) {
    restartBlock = true; // a recording a while into the paragraph: back to its start first
    return hear();
  }
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

// ---- The recording ("Запись") ----
// One <audio> for the whole reading (Safari lets it play on once it has played within a tap). The
// section's blocks (its title and paragraphs) share the file's time by the lengths of their texts.

/** Which engine is heard now. @type {'tts' | 'audio'} */
let heard = 'tts';
/** `size`: bytes. @typedef {{ paper: number, sections: number[], file: string, duration?: number, size?: number }} Recording */
/** The files by language and by "paper:section". @type {Record<string, Map<string, Recording>>} */
let recordings = {};
/** The files by language, in book order (the playlist). @type {Record<string, Recording[]>} */
export const recordingList = $state({});
let recordingsLoading = false;
/** Seconds ⏪ ⏩ move a recording by. */
export const SKIP = 15;

export function loadRecordings() {
  if (recordingsLoading) return;
  recordingsLoading = true;
  api.audio().then(
    (cat) => {
      recordings = {};
      for (const [lang, tracks] of Object.entries(cat)) {
        const m = new Map();
        for (const t of tracks) for (const sec of t.sections) m.set(`${t.paper}:${sec}`, t);
        recordings[lang] = m;
        recordingList[lang] = tracks;
      }
      tts.recorded = /** @type {('ru' | 'en')[]} */ (Object.keys(recordings).filter((l) => l === 'ru' || l === 'en'));
    },
    () => (recordingsLoading = false),
  );
}

/** The current language is to be heard from its recording. */
const wantsRecording = () => tts[tts.lang].source === 'audio' && tts.recorded.includes(tts.lang);

/** The section a block belongs to: "h3" → 3, "5:3.2" → 3. @param {string} key */
const sectionOf = (key) => Number(key.startsWith('h') ? key.slice(1) : key.slice(key.indexOf(':') + 1, key.indexOf('.')));

/** The file reading this block (of the paper on screen), or null. @param {string} key */
function recordingFor(key) {
  const paper = host?.paper();
  if (paper == null) return null;
  return recordings[tts.lang]?.get(`${paper}:${sectionOf(key)}`) ?? null;
}

/**
 * The file's blocks and where each starts and ends, as a share of the file. A block's weight is its
 * text plus a little for the pause after it.
 * @param {{ file: string, sections: number[] }} rec
 */
function layout(rec) {
  const els = elements().filter((el) => rec.sections.includes(sectionOf(el.dataset.ttsKey ?? '')));
  const weights = els.map((el) => readable(el).text.replace(/\s+/g, ' ').trim().length + 30);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return els.map((el, i) => {
    const from = at / total;
    at += weights[i];
    return { key: el.dataset.ttsKey ?? '', from, to: at / total };
  });
}

/** @type {HTMLAudioElement | null} */
let player = null;
/** The file playing and its blocks. @type {{ url: string, blocks: ReturnType<typeof layout> } | null} */
let playing = null;
/** ⏮ a while into a paragraph: from its start (not from where the recording is). */
let restartBlock = false;
/** ▶ or a resumed place: a recording may go on from the remembered second (tts.place.t). */
let resumeExact = false;

function tuneRecording() {
  if (!player) return;
  const v = tts[tts.lang];
  player.volume = v.volume;
  player.playbackRate = v.audioRate;
  player.preservesPitch = true;
}

/** Stops both voices (the one that is not heard is silent anyway). */
function silence() {
  synth?.cancel();
  player?.pause();
}

/** The block at the recording's present time. */
function blockNow() {
  if (!player || !playing || !Number.isFinite(player.duration) || !player.duration) return null;
  // (a little ahead: a paragraph is started a little before its estimated start — see hear())
  const f = (player.currentTime + 0.7) / player.duration;
  return playing.blocks.find((b) => f < b.to) ?? playing.blocks.at(-1) ?? null;
}
/** Seconds since the heard paragraph started. */
function intoBlock() {
  const b = blockNow();
  return b && player ? player.currentTime - b.from * player.duration : 0;
}

/** Runs `fn` once the file's length is known. @param {HTMLAudioElement} a @param {() => void} fn */
function withDuration(a, fn) {
  if (Number.isFinite(a.duration) && a.duration > 0) fn();
  else a.addEventListener('loadedmetadata', fn, { once: true });
}

/** Plays the recording at `pos`: goes on if it is there already, else from the paragraph's start. */
function hear() {
  const c = current();
  const rec = c && recordingFor(c.el.dataset.ttsKey ?? '');
  if (!c || !rec) return stop();
  clearTimeout(timer);
  synth?.cancel();
  heard = 'audio';
  const my = ++run;
  const url = `/api/audio/${tts.lang}/${encodeURIComponent(rec.file)}`;
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.addEventListener('timeupdate', onTime);
    player.addEventListener('ended', onEnded);
    player.addEventListener('error', () => {
      if (heard !== 'audio' || !tts.playing) return;
      pause();
      showToast('Запись не загрузилась — проверьте связь');
    });
  }
  const a = player;
  const same = playing?.url === url;
  playing = { url, blocks: layout(rec) };
  if (!same) {
    a.src = url;
    listened(tts.lang, rec.file, rec.size); // ("Сохранять прослушанное": kept quietly if chosen)
  }
  const paper = host?.paper() ?? 0;
  if (!same || !tts.track) tts.track = { paper, sections: rec.sections, file: rec.file, time: same ? a.currentTime : 0, duration: rec.duration ?? 0 };
  withDuration(a, () => tts.track?.file === rec.file && (tts.track.duration = a.duration)); // (the file's own, exact)
  tuneRecording();
  const key = c.el.dataset.ttsKey ?? '';
  const there = same && blockNow()?.key === key && !restartBlock;
  restartBlock = false;
  // the remembered second of this very paragraph (after a pause elsewhere, on another device, a new start)
  const saved = resumeExact && tts.place?.file === rec.file && tts.place.key === key && tts.place.t != null ? tts.place.t : null;
  resumeExact = false;
  if (!there && saved !== null) {
    withDuration(a, () => my === run && (a.currentTime = Math.max(0, Math.min(saved - 1, a.duration - 1)))); // (a second back: the word goes on whole)
  } else if (!there) {
    const b = playing.blocks.find((x) => x.key === key);
    // (a little before the estimate: better to hear the end of the previous paragraph than to miss a word)
    withDuration(a, () => my === run && (a.currentTime = Math.max(0, (b?.from ?? 0) * a.duration - 0.6)));
  }
  showPosition();
  a.play().catch((err) => {
    if (my !== run || err?.name === 'AbortError') return;
    pause();
    showToast(err?.name === 'NotAllowedError' ? 'Нажмите ▶, чтобы слушать' : 'Запись не воспроизводится');
  });
  heardRun = my;
}
/** The `run` the recording plays in (older events are ignored). */
let heardRun = 0;

function onTime() {
  if (heard !== 'audio' || !player) return;
  if (tts.track && Number.isFinite(player.currentTime)) tts.track.time = player.currentTime;
  if (!tts.playing || heardRun !== run) return;
  const b = blockNow();
  if (!b) return;
  updatePositionState();
  const share = (player.currentTime / player.duration - b.from) / Math.max(1e-6, b.to - b.from);
  if (pos?.key === b.key) {
    remember(Math.min(1, Math.max(0, share)));
    return;
  }
  // one paragraph asked for (its ▶ in the text): it ends where the next one starts
  if (onlyKey !== null && pos?.key === onlyKey) {
    onlyKey = null;
    return pause();
  }
  pos = { key: b.key, s: 0 };
  showPosition();
}

function onEnded() {
  if (heard !== 'audio' || !tts.playing || heardRun !== run || !playing) return;
  if (onlyKey !== null) {
    onlyKey = null;
    return pause();
  }
  // the next section's file (or the next paper)
  const last = playing.blocks.at(-1)?.key;
  const list = elements();
  const i = list.findIndex((el) => el.dataset.ttsKey === last);
  const next = i >= 0 ? list[i + 1] : undefined;
  if (next) {
    pos = { key: next.dataset.ttsKey ?? '', s: 0 };
    speak();
  } else endOfPaper();
}

/** ⏪ ⏩: the recording moves by seconds. @param {number} sec */
function skip(sec) {
  const a = player;
  if (!a || heard !== 'audio') return;
  userAt = 0;
  withDuration(a, () => {
    a.currentTime = Math.min(Math.max(0, a.currentTime + sec), Math.max(0, a.duration - 0.2));
    follow();
  });
}

/** After a jump in the file: the highlight goes where the recording is (paused too: ▶ goes on from there). */
function follow() {
  if (!player) return;
  if (tts.track) tts.track.time = player.currentTime;
  if (tts.playing) return onTime();
  const b = blockNow();
  if (b) {
    pos = { key: b.key, s: 0 };
    showPosition();
  }
}

/** The progress line while a recording is heard: a place in its file (a share, 0…1). @param {number} frac */
export function seekTrack(frac) {
  const a = player;
  if (!a || heard !== 'audio' || !playing) return;
  userAt = 0;
  withDuration(a, () => {
    a.currentTime = Math.min(Math.max(0, frac), 1) * Math.max(0, a.duration - 0.2);
    follow();
  });
}

/**
 * The playlist: a file from its start — its first section's title (in another paper, that paper is
 * opened first). Plays on to ■. @param {number} paper @param {number} section
 */
export function playTrack(paper, section) {
  if (!host) return;
  onlyKey = null;
  if (!tts.open) openPlayer();
  const key = `h${section}`;
  if (host.paper() === paper && elements().some((e) => e.dataset.ttsKey === key)) {
    if (tts.playing) {
      run++;
      clearTimeout(timer);
      silence();
    }
    pos = { key, s: 0 };
    restartBlock = true;
    start();
  } else {
    pause();
    resumeTo = { paper, key, s: 0 };
    navigate(section ? `/${paper}:${section}.1` : `/${paper}`, { replace: true }); // the app moves, not the reader: no history entry
  }
}

/** The lock screen's own progress line (the file being heard). */
function updatePositionState() {
  const ms = navigator.mediaSession;
  if (!ms?.setPositionState || !player || !Number.isFinite(player.duration)) return;
  try {
    ms.setPositionState({ duration: player.duration, position: Math.min(player.currentTime, player.duration), playbackRate: player.playbackRate });
  } catch {}
}

// ---- The voice as people choose it: one list — the narrator (a recording) and the device's voices ----

/** The narrator's value in the list of voices. */
export const NARRATOR = 'narrator';
/** Who reads the recording of each language. */
export const NARRATORS = /** @type {Record<string, string>} */ ({ ru: 'Григорий Войнер', en: 'Merritt Horn' });
/** The current language's voice as the list shows it: the narrator, or a synthesized voice ('' — the system's). */
export const voiceChoice = () => (tts[tts.lang].source === 'audio' && tts.recorded.includes(tts.lang) ? NARRATOR : tts[tts.lang].voice);
/** The list of voices: the narrator first (where the language has a recording), then the synthesized ones. */
export function voiceOptions() {
  /** @type {{ value: string, label: string, hint?: string, group?: string }[]} */
  const out = [];
  if (tts.recorded.includes(tts.lang)) out.push({ value: NARRATOR, label: NARRATORS[tts.lang], hint: 'Живой голос диктора' }); // (first, without a label: the synthesized ones follow under theirs)
  out.push({ value: '', label: 'Системный', hint: native ? 'Движок и голос из настроек Android' : 'Голос по умолчанию на этом устройстве', group: 'Синтез речи' });
  // (in the Android app the voices of each engine go under its name: Google, Huawei…)
  for (const x of voicesFor(tts.lang)) {
    const group = x.engine ? `Синтез речи · ${x.engine}` : 'Синтез речи';
    out.push({ value: x.id, label: x.name, hint: x.online ? 'онлайн-голос' : x.engine ? 'на устройстве' : undefined, group });
  }
  return out;
}
/** A voice chosen from the list. @param {string} x */
export function chooseVoice(x) {
  if (x === NARRATOR) return setVoice('source', 'audio');
  if (tts[tts.lang].source === 'audio') setVoice('source', 'tts');
  setVoice('voice', x);
}
/** The speed of what is heard (the narrator and the synthesized voice keep their own). */
const rateKey = () => (tts[tts.lang].source === 'audio' && tts.recorded.includes(tts.lang) ? 'audioRate' : 'rate');
export const currentRate = () => tts[tts.lang][rateKey()];
/** One button: +0.2 each tap, from 0.6 to 2.0, then round again. */
export function nextRate() {
  const r = currentRate();
  let n = (Math.floor(r / 0.2 + 1e-6) + 1) * 0.2;
  if (n > 2.0 + 1e-6) n = 0.6;
  setVoice(rateKey(), Math.round(n * 100) / 100);
}
/** The synthesized voice's tone: − / + by 0.1, from 0.5 to 2.0. @param {1 | -1} dir */
export function stepPitch(dir) {
  const p = Math.min(2, Math.max(0.5, tts[tts.lang].pitch + dir * 0.1));
  setVoice('pitch', Math.round(p * 10) / 10);
}
