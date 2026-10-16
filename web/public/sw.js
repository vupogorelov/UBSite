// Service worker: makes the app installable, quick to open, and usable without a network.
// - The app shell (index.html and the hashed /assets/ it references) is cached at install, so the
//   app opens instantly and even offline; pages are still fetched from the network first.
// - Fonts and icons are cached on first use.
// - The book's text (contents, papers) is answered from the copy lib/offline.svelte.js keeps in the
//   "ub-book" cache (gzipped as the server sent it) first: a paper opens at once. The rest of the book
//   (terms, the glossary, the pronunciation dictionary — editable) comes from the network, the copy
//   answering when the network fails, is silent for WAIT ms or the server errs (5xx).
// - Other API reads are answered by the network too, and their last answer is kept ("ub-last") for
//   the same cases: the app starts and shows what was seen before. Signing out clears it.
// - The recorded reading's files the person chose to keep ("ub-audio") are played from the device,
//   seeking included (Range).
// The registration URL carries the build id (sw.js?v=…), so every new build installs a new worker
// that replaces the old shell caches (the book, the last answers, the search index, the recordings stay).

/** The worker's own scope (typed loosely: the checker knows the page's globals, not a worker's). @type {any} */
const sw = self;

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `ub-${VERSION}`;
const BOOK = 'ub-book';
const LAST = 'ub-last';
/** How long the network has before the saved answer is given. */
const WAIT = 4000;
/** The book's URLs (server/offline.js lists the same). */
const BOOK_PATH = /^\/api\/(toc|glossary|pronunciations|stem-aliases|papers\/\d+(\/terms)?)$/;
/**
 * The book's text (the contents, the papers): the device's copy answers first — a paper opens at once,
 * with or without a network. The copy follows the server by its manifest (lib/offline.svelte.js: at the
 * start, every hour, on coming back to the app), so it is the server's text; what it lacks, the network gives.
 */
const TEXT_PATH = /^\/api\/(toc|papers\/\d+)$/;
/** API reads never answered from a cache: live streams, files, the copy itself, sign-in. */
const LIVE_PATH = /^\/api\/(chat\/stream|audio\/|offline\/|export|auth\/(login|logout|register)|search|workspaces\/\d+\/changes|tasks\/changes)/;

self.addEventListener('install', (/** @type {any} */ event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('/', { cache: 'no-store' });
      const html = await res.clone().text();
      await cache.put('/', res);
      const assets = [...html.matchAll(/(?:src|href)="(\/(?:assets|icons)\/[^"]+|\/theme\.js|\/manifest\.webmanifest)"/g)].map((m) => m[1]);
      // every part of the build, the ones loaded later too (a page opened first without a network works)
      try {
        const built = await (await fetch('/.vite/manifest.json', { cache: 'no-store' })).json();
        for (const c of Object.values(built)) for (const f of [c.file, ...(c.css ?? [])]) if (f) assets.push(`/${f}`);
      } catch {} // (a development server has none)
      await cache.addAll([...new Set(assets)]);
      await sw.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (/** @type {any} */ event) => {
  event.waitUntil(
    (async () => {
      // (the book, the last answers and the search's word index — lib/search.worker.js — stay)
      for (const key of await caches.keys()) if (key !== CACHE && key !== BOOK && key !== LAST && key !== 'ub-search' && key !== AUDIO) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

const AUDIO = 'ub-audio';
/**
 * A recording's file kept on the device (lib/recordings.svelte.js), whole or the part the player asks
 * for (Range: it seeks without the network as with it). Null — not kept: the network answers.
 * @param {Request} req @param {string} path
 */
async function fromAudio(req, path) {
  const hit = await caches.match(path, { cacheName: AUDIO });
  if (!hit) return null;
  const blob = await hit.blob();
  const size = blob.size;
  const type = hit.headers.get('Content-Type') ?? 'audio/mpeg';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') ?? '');
  if (!m || (!m[1] && !m[2])) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  }
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
  });
}

/** The book's saved answer, unpacked. @param {string} path */
async function fromBook(path) {
  const hit = await caches.match(path, { cacheName: BOOK });
  if (!hit || !hit.body) return null;
  return new Response(hit.body.pipeThrough(new DecompressionStream('gzip')), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Offline': '1' },
  });
}

/**
 * The network first; the saved answer if the network fails, is silent for WAIT ms or the server errs.
 * Without a saved answer the network is simply waited for. `keep`: store a good answer as the last one.
 * @param {Request} req @param {() => Promise<Response | null | undefined>} saved @param {boolean} keep
 */
function networkFirst(req, saved, keep) {
  const net = fetch(req).then((res) => {
    if (keep && res.status === 200) {
      const copy = res.clone();
      caches.open(LAST).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
  if (self.navigator.onLine === false) return saved().then((r) => r || net);
  return new Promise((resolve, reject) => {
    let done = false;
    /** @param {unknown} why @param {Response} [res] the server's own (error) answer */
    const fallBack = (why, res) =>
      saved().then((r) => {
        if (done) return;
        if (r) {
          done = true;
          resolve(r);
        } else if (res) {
          done = true;
          resolve(res); // (the server's error answer, nothing better)
        } else if (why !== 'slow') {
          done = true;
          reject(why);
        } // slow and nothing saved: the network is waited for
      });
    const timer = setTimeout(() => fallBack('slow'), WAIT);
    net.then(
      (res) => {
        if (res.status >= 500) return void fallBack('server', res);
        clearTimeout(timer);
        if (!done) (done = true), resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        fallBack(err);
      },
    );
  });
}

self.addEventListener('fetch', (/** @type {any} */ event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // a recording's file: from the device if kept, otherwise the network as before
    if (/^\/api\/audio\/[^/]+\/[^/]+$/.test(url.pathname)) {
      event.respondWith(fromAudio(req, url.pathname).then((r) => r || fetch(req)));
      return;
    }
    if (LIVE_PATH.test(url.pathname)) return;
    if (TEXT_PATH.test(url.pathname)) event.respondWith(fromBook(url.pathname).then((r) => r || fetch(req)));
    else if (BOOK_PATH.test(url.pathname)) event.respondWith(networkFirst(req, () => fromBook(url.pathname), false));
    else event.respondWith(networkFirst(req, () => caches.match(req, { cacheName: LAST }), true));
    return;
  }

  // Pages (any app route): network first, the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return (await caches.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed assets, fonts, icons: cache first (they never change under the same name).
  if (/^\/(assets|fonts|icons)\//.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      })(),
    );
  }
});
