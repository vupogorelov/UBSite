// Service worker: makes the app installable and quick to open.
// - The app shell (index.html and the hashed /assets/ it references) is cached at install, so the
//   app opens instantly and even offline; pages are still fetched from the network first.
// - Fonts and icons are cached on first use. The API (/api/…) is never cached: data stays live.
// The registration URL carries the build id (sw.js?v=…), so every new build installs a new worker
// that replaces the old caches.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `ub-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('/', { cache: 'no-store' });
      const html = await res.clone().text();
      await cache.put('/', res);
      const assets = [...html.matchAll(/(?:src|href)="(\/(?:assets|icons)\/[^"]+|\/theme\.js|\/manifest\.webmanifest)"/g)].map((m) => m[1]);
      await cache.addAll([...new Set(assets)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

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
