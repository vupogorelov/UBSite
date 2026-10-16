// @ts-check
// Search without a network, in a thread of its own: the shared search core (shared/search/core.js)
// with the JS word filter (fts.js) over the book this device keeps ("ub-book", lib/offline.svelte.js).
// The word index takes seconds to build on a phone, so it is built ahead — quietly, while there is a
// network, right after the book is saved ("prepare") — and kept in "ub-search" under the key of the
// book's text; without a network it is only read back.
import { createSearchCore } from '../../../shared/search/core.js';
import { createWordFilter, buildWordIndex, packWordIndex, unpackWordIndex } from '../../../shared/search/fts.js';
import { bookFromCopy, gotoPath } from '../../../shared/search/offline-data.js';
import { setStemAliases } from '../../../shared/search/text.js';
import { QueryError } from '../../../shared/search/query.js';

const INDEX = 'ub-search';

/** A saved answer of the API, unpacked. @param {string} path */
async function read(path) {
  const hit = await caches.match(path, { cacheName: 'ub-book' });
  if (!hit?.body) throw new Error('Книга ещё не сохранена на этом устройстве');
  return new Response(hit.body.pipeThrough(new DecompressionStream('gzip'))).json();
}

/** @param {Blob | ReadableStream<Uint8Array>} data @param {CompressionStream | DecompressionStream} through */
const transform = (data, through) => new Response((data instanceof Blob ? data.stream() : data).pipeThrough(/** @type {any} */ (through))).arrayBuffer();

/** @param {string} key the book text's key ('' — not known: built, not kept) */
async function load(key) {
  setStemAliases(new Map(await read('/api/stem-aliases'))); // (before any word is split)
  const toc = await read('/api/toc');
  /** @type {any[]} */
  const papers = [];
  for (const p of toc.papers) papers.push(await read(`/api/papers/${p.id}`)); // (one at a time: less memory at once)
  const book = bookFromCopy(toc, papers);
  papers.length = 0;

  const cache = await caches.open(INDEX);
  const name = `/offline-search/${key}`;
  let index = null;
  const hit = key ? await cache.match(name) : undefined;
  if (hit?.body) {
    try {
      index = unpackWordIndex(await transform(hit.body, new DecompressionStream('gzip')));
    } catch {}
  }
  if (!index) {
    index = buildWordIndex(book.paras);
    if (key) {
      const gz = await transform(new Blob([packWordIndex(index)]), new CompressionStream('gzip'));
      for (const old of await cache.keys()) await cache.delete(old);
      await cache.put(name, new Response(gz));
    }
  }
  return { book, core: createSearchCore(book.paras, createWordFilter(book.paras, index)) };
}

/** @type {ReturnType<typeof load> | null} */
let ready = null;
const ctx = {
  tagRefs: () => {
    throw new QueryError('Поиск по меткам работает только при связи');
  },
};

self.onmessage = async (/** @type {MessageEvent} */ e) => {
  const m = e.data;
  try {
    ready ??= load(m.key ?? '');
    const { book, core } = await ready;
    const result =
      m.op === 'prepare' ? true
      : m.op === 'search' ? core.search(m.text, m.offset, m.limit, ctx)
      : m.op === 'highlights' ? core.highlights(m.text, m.paper, ctx)
      : gotoPath(book, m.text);
    self.postMessage({ id: m.id, result });
  } catch (err) {
    const answer = err instanceof QueryError || !!(/** @type {any} */ (err)?.status);
    if (!answer) ready = null; // (the book was not readable: again next time)
    self.postMessage({ id: m.id, error: { message: /** @type {Error} */ (err).message, answer } });
  }
};
