// @ts-check
// The narrator's recording without a network (TODO.md "Без сети", step 4): the one thing the person
// decides about — it is large (gigabytes), so it is downloaded only by choice: a paper, a part or the
// whole recording, its size told beforehand, the progress shown, pause, cancel, and what was downloaded
// can be removed (all of it, or what a cancelled download had saved). Kept in "ub-audio"; the service
// worker plays it from there, seeking included (public/sw.js). Files go one at a time and only whole
// ones are kept; without a network a download pauses itself and goes on when the network is back.
// "Сохранять прослушанное" (off by default): a file heard is kept quietly, and can be freed.

const AUDIO = 'ub-audio';
const LISTENED_KEY = 'ub.keptListened';
const SETTING_KEY = 'ub.keepListened';

/** @typedef {{ lang: string, file: string, size: number }} AudioFile */

export const rec = $state({
  /** What is kept: bytes by "lang/file". @type {Record<string, number>} */
  saved: {},
  /** Kept because heard ("Сохранять прослушанное"): "lang/file". @type {string[]} */
  listened: [],
  keepListened: false,
  /**
   * The download going on: what it is, its files, how far. `paused`: 'user' (a tap) or 'network'.
   * @type {{ label: string, files: AudioFile[], done: number, bytes: number, total: number, fileBytes: number, paused: 'user' | 'network' | null, error: string, made: string[] } | null}
   */
  job: null,
  /** The device's space: used and offered by the browser (navigator.storage.estimate). */
  usage: 0,
  quota: 0,
});

const key = (/** @type {string} */ lang, /** @type {string} */ file) => `${lang}/${file}`;
const path = (/** @type {string} */ k) => `/api/audio/${k}`;
const possible = typeof caches !== 'undefined';

try {
  rec.keepListened = localStorage.getItem(SETTING_KEY) === '1';
  rec.listened = JSON.parse(localStorage.getItem(LISTENED_KEY) ?? '[]');
} catch {}
const saveListened = () => {
  try {
    localStorage.setItem(LISTENED_KEY, JSON.stringify(rec.listened));
  } catch {}
};

/** Reads what is kept (and the device's space). */
export async function loadKept() {
  if (!possible) return;
  const cache = await caches.open(AUDIO);
  /** @type {Record<string, number>} */
  const saved = {};
  for (const req of await cache.keys()) {
    const k = decodeURIComponent(new URL(req.url).pathname.slice('/api/audio/'.length));
    const res = await cache.match(req);
    saved[k] = Number(res?.headers.get('Content-Length') ?? 0);
  }
  rec.saved = saved;
  rec.listened = rec.listened.filter((k) => k in saved);
  saveListened();
  await space();
}
async function space() {
  try {
    const e = await navigator.storage?.estimate?.();
    rec.usage = e?.usage ?? 0;
    rec.quota = e?.quota ?? 0;
  } catch {}
}

/** Bytes kept of these files. @param {AudioFile[]} files */
export const keptBytes = (files) => files.reduce((s, f) => s + (rec.saved[key(f.lang, f.file)] ? f.size : 0), 0);
/** All of them kept. @param {AudioFile[]} files */
export const allKept = (files) => files.length > 0 && files.every((f) => key(f.lang, f.file) in rec.saved);

/** @type {AbortController | null} */
let current = null;
let running = false;

/**
 * Downloads these files (only the ones not kept yet); a download going on takes them into its queue.
 * @param {string} label what it is ("Часть I", "Вся запись") @param {AudioFile[]} files
 */
export function download(label, files) {
  const want = files.filter((f) => !(key(f.lang, f.file) in rec.saved));
  if (!want.length) return;
  void navigator.storage?.persist?.(); // (the browser keeps what was chosen)
  if (rec.job) {
    const have = new Set(rec.job.files.map((f) => key(f.lang, f.file)));
    for (const f of want) if (!have.has(key(f.lang, f.file))) rec.job.files.push(f), (rec.job.total += f.size);
    if (rec.job.label !== label) rec.job.label = `${rec.job.label} + ${label}`;
  } else rec.job = { label, files: want, done: 0, bytes: 0, total: want.reduce((s, f) => s + f.size, 0), fileBytes: 0, paused: null, error: '', made: [] };
  void run();
}

async function run() {
  if (running || !rec.job) return;
  running = true;
  const cache = await caches.open(AUDIO);
  try {
    while (rec.job && !rec.job.paused && rec.job.done < rec.job.files.length) {
      const job = rec.job;
      const f = job.files[job.done];
      const k = key(f.lang, f.file);
      if (k in rec.saved) {
        job.done++;
        job.bytes += f.size;
        continue;
      }
      current = new AbortController();
      try {
        const res = await fetch(path(k), { signal: current.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        const reader = res.body.getReader();
        /** @type {Uint8Array[]} */
        const parts = [];
        job.fileBytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          job.fileBytes += value.length;
        }
        const blob = new Blob(/** @type {BlobPart[]} */ (parts), { type: res.headers.get('Content-Type') ?? 'audio/mpeg' });
        await cache.put(path(k), new Response(blob, { headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size) } }));
        rec.saved = { ...rec.saved, [k]: blob.size };
        job.made.push(k);
        job.done++;
        job.bytes += f.size;
        job.fileBytes = 0;
        job.error = '';
      } catch (err) {
        job.fileBytes = 0;
        if (/** @type {any} */ (err)?.name === 'AbortError') break; // (paused or cancelled by a tap)
        if (/** @type {any} */ (err)?.status === 404) {
          job.done++; // (gone from the catalog: skipped)
          continue;
        }
        // no network (or no room): paused, goes on when the network is back
        job.paused = 'network';
        job.error = navigator.onLine === false ? 'Нет связи — продолжится, когда она появится' : `Остановлено: ${/** @type {Error} */ (err).message}`;
      } finally {
        current = null;
      }
    }
    if (rec.job && rec.job.done >= rec.job.files.length) rec.job = null; // (all there)
  } finally {
    running = false;
    void space();
  }
}

export function pause() {
  if (!rec.job) return;
  rec.job.paused = 'user';
  current?.abort();
}
export function resume() {
  if (!rec.job) return;
  rec.job.paused = null;
  rec.job.error = '';
  void run();
}
/** Stops the download; `removeMade`: also removes the files it had saved. @param {boolean} [removeMade] */
export async function cancel(removeMade = false) {
  const job = rec.job;
  rec.job = null;
  current?.abort();
  if (removeMade && job) await remove(job.made);
}

/** Removes kept files ("lang/file"). @param {string[]} keys */
export async function remove(keys) {
  const cache = await caches.open(AUDIO);
  const saved = { ...rec.saved };
  for (const k of keys) {
    await cache.delete(path(k));
    delete saved[k];
  }
  rec.saved = saved;
  rec.listened = rec.listened.filter((k) => k in saved);
  saveListened();
  await space();
}
/** @param {AudioFile[]} files */
export const removeFiles = (files) => remove(files.map((f) => key(f.lang, f.file)).filter((k) => k in rec.saved));

/** "Сохранять прослушанное". @param {boolean} on */
export function setKeepListened(on) {
  rec.keepListened = on;
  try {
    localStorage.setItem(SETTING_KEY, on ? '1' : '0');
  } catch {}
}
/** What was kept because heard, freed. */
export const freeListened = () => remove([...rec.listened]);

/** A file of the recording started playing: kept quietly if so chosen. @param {string} lang @param {string} file @param {number} [size] */
export function listened(lang, file, size = 0) {
  const k = key(lang, file);
  if (!possible || !rec.keepListened || k in rec.saved || navigator.onLine === false) return;
  void (async () => {
    try {
      const res = await fetch(path(k), { cache: 'no-store' });
      if (!res.ok) return;
      const blob = await res.blob();
      await (await caches.open(AUDIO)).put(path(k), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg', 'Content-Length': String(blob.size) } }));
      rec.saved = { ...rec.saved, [k]: blob.size || size };
      rec.listened = [...rec.listened, k];
      saveListened();
    } catch {}
  })();
}

if (typeof window !== 'undefined') {
  // a download paused by a lost network goes on by itself
  addEventListener('online', () => rec.job?.paused === 'network' && resume());
  void loadKept();
}
