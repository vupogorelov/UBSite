// @ts-check
// The book on this device, for reading without a network: prepared by itself after signing in,
// with no questions (VISION.md, principles 10–11), and kept up to date the same way.
//
// The server lists the book's answers with the hashes of their contents (server/offline.js); the files
// this device lacks or has in an older version are downloaded, checked against their hash and kept
// gzipped in the "ub-book" cache, from which the service worker (public/sw.js) answers when the
// network does not. Only what changed is downloaded again.

import { log } from './log.js';

const BOOK = 'ub-book';
const LAST = 'ub-last';
const META_KEY = 'ub.offline';
/** Files downloaded at once. */
const PARALLEL = 4;
/** How often the copy is checked against the server while the app is open. */
const CHECK_MS = 60 * 60_000;

/** @typedef {{ url: string, hash: string, size: number }} OfflineFile */

export const offline = $state({
  /** 'none': not prepared yet (or not possible here) · 'loading' · 'ready' · 'waiting': needs the network. */
  state: /** @type {'none' | 'loading' | 'ready' | 'waiting'} */ ('none'),
  /** Bytes saved (of `total` while loading). */
  bytes: 0,
  total: 0,
  /** The search's word index for this book is kept too (search without a network starts at once). */
  searchReady: false,
});
const SEARCH_KEY = 'ub.offlineSearch';

const possible = typeof caches !== 'undefined' && typeof DecompressionStream !== 'undefined' && 'serviceWorker' in navigator;
/** This browser can keep the book (a secure page with a service worker). */
export const offlinePossible = possible;

/** "6,6 МБ". @param {number} bytes */
export const megabytes = (bytes) => `${(bytes / 1048576).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ`;
/** "4,2 ГБ" from a gigabyte on, else "38 МБ". @param {number} bytes */
export const bytesText = (bytes) =>
  bytes >= 1073741824 ? `${(bytes / 1073741824).toLocaleString('ru', { maximumFractionDigits: 1 })} ГБ` : `${Math.max(bytes ? 0.1 : 0, Math.round(bytes / 104857.6) / 10).toLocaleString('ru')} МБ`;

/** @typedef {{ build: string, bytes: number, search?: string }} Meta `search`: the key of the book's text (what the word index is made of) */
/** @returns {Meta | null} */
function readMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null');
    return m && typeof m.build === 'string' ? m : null;
  } catch {
    return null;
  }
}
/** @param {Meta} m */
function saveMeta(m) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {}
}
/** The key of the book's text the search index must be made of ('' — not known yet). */
export const searchKey = () => readMeta()?.search ?? '';
const keptSearch = () => {
  try {
    return localStorage.getItem(SEARCH_KEY) ?? '';
  } catch {
    return '';
  }
};
/** The device's search kept its word index for this text. @param {string} key */
export function searchKept(key) {
  try {
    localStorage.setItem(SEARCH_KEY, key);
  } catch {}
  offline.searchReady = key === searchKey();
}
{
  const m = possible ? readMeta() : null;
  if (m) {
    offline.state = 'ready';
    offline.bytes = offline.total = m.bytes;
    offline.searchReady = !!m.search && keptSearch() === m.search;
  }
}

/** The files the search is made of (the text, the contents, the stem merges): their hashes, as one key. @param {OfflineFile[]} files */
async function textKey(files) {
  const text = files.filter((f) => /^\/api\/(toc|stem-aliases|papers\/\d+)$/.test(f.url)).map((f) => f.hash).join('');
  const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...sum.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The first 16 hex digits of SHA-256 of what the gzip unpacks to (as the server names it). @param {ArrayBuffer} gz */
async function hashOf(gz) {
  const plain = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', plain));
  return [...sum.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the cache holds: hash by URL path. @param {Cache} cache */
async function held(cache) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    const hash = res?.headers.get('x-hash');
    if (hash) out.set(new URL(req.url).pathname, hash);
  }
  return out;
}

let running = false;
let started = false;

/** Brings the copy up to date (quietly; again later if the network is missing). */
export async function syncOffline() {
  if (!possible || running) return;
  running = true;
  try {
    const res = await fetch('/api/offline/manifest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    /** @type {{ build: string, files: OfflineFile[] }} */
    const manifest = await res.json();
    const all = manifest.files.reduce((s, f) => s + f.size, 0);
    const cache = await caches.open(BOOK);
    const have = await held(cache);
    const todo = manifest.files.filter((f) => have.get(f.url) !== f.hash);
    if (todo.length) {
      void navigator.storage?.persist?.(); // (asked once the book is being saved: the browser keeps it then)
      offline.state = 'loading';
      offline.total = all;
      offline.bytes = all - todo.reduce((s, f) => s + f.size, 0);
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const f = todo[next++];
          const r = await fetch(`/api/offline/file/${f.hash}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`); // (404: the copy changed meanwhile — next time)
          const gz = await r.arrayBuffer();
          if ((await hashOf(gz)) !== f.hash) throw new Error(`Файл ${f.url} пришёл повреждённым`);
          await cache.put(f.url, new Response(gz, { headers: { 'Content-Type': 'application/gzip', 'X-Hash': f.hash } }));
          offline.bytes += f.size;
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    }
    // what the book no longer has
    const listed = new Set(manifest.files.map((f) => f.url));
    for (const url of have.keys()) if (!listed.has(url)) await cache.delete(url);
    const search = await textKey(manifest.files);
    if (todo.length) log('offline', 'копия книги обновлена', { files: todo.length, bytes: todo.reduce((s, f) => s + f.size, 0) });
    saveMeta({ build: manifest.build, bytes: all, search });
    offline.state = 'ready';
    offline.bytes = offline.total = all;
    offline.searchReady = keptSearch() === search;
    // the search's word index for this text: built now, while there is a network (lib/offline-search.js)
    if (!offline.searchReady) dispatchEvent(new CustomEvent('ub-search-prepare'));
  } catch (err) {
    if (navigator.onLine !== false) log('offline', 'копия книги не обновилась', { error: /** @type {Error} */ (err).message }, 'warn');
    // an earlier copy still answers (what was not updated stays as it was)
    const m = readMeta();
    offline.state = m ? 'ready' : 'waiting';
    if (m) offline.bytes = offline.total = m.bytes;
  } finally {
    running = false;
  }
}

/** After signing in: prepare the copy a little later (the open paper loads first), then keep it fresh. */
export function startOffline() {
  if (!possible || started) return;
  started = true;
  setTimeout(syncOffline, 3000);
  setInterval(syncOffline, CHECK_MS);
  addEventListener('online', () => void syncOffline());
}

/** Signing out: what was seen of the person's own data is forgotten on this device (the book stays). */
export async function forgetPersonal() {
  if (possible) await caches.delete(LAST).catch(() => {});
}
