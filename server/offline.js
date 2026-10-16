// @ts-check
// The book for reading without a network (web/src/lib/offline.svelte.js, web/public/sw.js).
//
// The copy is the API's own answers: every book URL (contents, papers, their glossary terms, the
// glossary, the pronunciation dictionary, the search's stem merges) is answered by the same route handler as a live request and
// serialized the same way, so a saved answer is byte for byte what the server would send. Each answer
// is kept gzipped and named by the hash of its JSON; the manifest lists them, and its `build` changes
// only when something in the copy changed. A device downloads only the files it lacks.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { HttpError, STREAM } from './http.js';

/** How long a built manifest is trusted before the answers are produced again (book data changes rarely). */
const FRESH_MS = 5 * 60_000;

/** @typedef {{ url: string, hash: string, size: number }} OfflineFile */

/**
 * @param {ReturnType<typeof import('./http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createOffline(router, db) {
  const paperIds = db.prepare('SELECT id FROM papers ORDER BY id');
  /** Gzipped answers by hash (kept across rebuilds while still listed). @type {Map<string, Buffer>} */
  let files = new Map();
  /** @type {{ build: string, files: OfflineFile[] } | null} */
  let manifest = null;
  let builtAt = 0;
  /** The book changed since the last build: its stored answers are not given out until the next one. */
  let stale = false;

  /** The book's URLs, in the order a device downloads them (the contents first). */
  function urls() {
    const ids = /** @type {{ id: number }[]} */ (paperIds.all()).map((r) => r.id);
    return ['/api/toc', '/api/glossary', '/api/pronunciations', '/api/stem-aliases', ...ids.map((id) => `/api/papers/${id}`), ...ids.map((id) => `/api/papers/${id}/terms`)];
  }

  /** A route's answer as sendJson writes it. @param {string} url */
  async function answer(url) {
    const u = new URL(url, 'http://localhost');
    const route = router.match('GET', u.pathname);
    if (!route) throw new Error(`No route for ${url}`);
    const data = await route.handler({ req: /** @type {any} */ (null), res: /** @type {any} */ (null), params: route.params, url: u, user: /** @type {any} */ (null) });
    return Buffer.from(JSON.stringify(data ?? null));
  }

  async function build() {
    /** @type {Map<string, Buffer>} */
    const next = new Map();
    /** @type {OfflineFile[]} */
    const list = [];
    for (const url of urls()) {
      await new Promise((r) => setImmediate(r)); // (a file at a time: other requests are answered in between)
      const body = await answer(url);
      const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
      const gz = files.get(hash) ?? next.get(hash) ?? gzipSync(body, { level: 9 });
      next.set(hash, gz);
      list.push({ url, hash, size: gz.length });
    }
    const build = createHash('sha256').update(list.map((f) => `${f.url} ${f.hash}`).join('\n')).digest('hex').slice(0, 16);
    files = next;
    manifest = { build, files: list };
    builtAt = Date.now();
    byUrl = new Map(list.map((f) => [f.url, f]));
    stale = false;
    return manifest;
  }

  /** @type {Map<string, OfflineFile>} */
  let byUrl = new Map();
  /** @type {Promise<unknown> | null} */
  let building = null;
  /** The current manifest (built again when older than FRESH_MS; one build at a time). */
  async function current() {
    if (!manifest || Date.now() - builtAt > FRESH_MS) {
      building ??= build().finally(() => (building = null));
      // an older manifest still answers while the new one is built (its files stay until the build ends)
      if (!manifest) await building;
    }
    return /** @type {NonNullable<typeof manifest>} */ (manifest);
  }
  // built at start, so the first device does not wait
  setTimeout(() => current().catch((err) => console.error('Offline copy failed:', err)), 2000).unref();

  return {
    current,
    /** @param {string} hash */
    file: (hash) => files.get(hash) ?? null,
    /**
     * A book URL's stored answer, gzipped, with its hash (an ETag): the same bytes the route would give,
     * made once instead of on every request. null — not stored, or the book changed and it is being made again.
     * @param {string} url
     */
    stored(url) {
      if (stale || !manifest) return null;
      const f = byUrl.get(url);
      const gz = f && files.get(f.hash);
      return f && gz ? { hash: f.hash, gz } : null;
    },
    /** The book changed (the English text from its source): the answers are made again. */
    invalidate() {
      stale = true;
      builtAt = 0;
      current().catch((err) => console.error('Offline copy failed:', err));
    },
  };
}

/**
 * @param {ReturnType<typeof import('./http.js').createRouter>} router
 * @param {ReturnType<typeof createOffline>} offline
 */
export function registerOfflineRoutes(router, offline) {
  router.on('GET', '/api/offline/manifest', () => offline.current());

  // One saved answer, gzipped as stored (the device keeps it so and unpacks it when read).
  router.on('GET', '/api/offline/file/:hash', async ({ res, params }) => {
    await offline.current();
    const gz = offline.file(params.hash);
    if (!gz) throw new HttpError(404, 'Нет такого файла (копия обновилась)');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': gz.length,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(gz);
    return STREAM;
  });
}
