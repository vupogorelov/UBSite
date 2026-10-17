// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { registerBookRoutes } from './api/book.js';
import { registerGlossaryRoutes } from './api/glossary.js';
import { registerPronunciationRoutes } from './api/pronunciations.js';
import { createGlossary } from './glossary.js';
import { createTermIndex } from './terms.js';
import { createOffline } from './offline.js';
import { createTextSync } from './textsync.js';

test("the book's stored answers: the route's own bytes; the book changed — not given out until made again, the contents read anew", async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Old title');
    INSERT INTO sections (paper_id, num, title_ru, title_en) VALUES (5, 1, 'Раздел', 'Section');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'а', 'Love.', 'а', 'Love.');
  `);
  const router = createRouter();
  const book = registerBookRoutes(router, db);
  const glossary = createGlossary(db);
  registerGlossaryRoutes(router, db, glossary, createTermIndex(db, glossary));
  registerPronunciationRoutes(router, db);
  const offline = createOffline(router, db);
  /** @param {string} path */
  const live = async (path) => {
    const r = /** @type {NonNullable<ReturnType<typeof router.match>>} */ (router.match('GET', path));
    return JSON.stringify(await r.handler(/** @type {any} */ ({ params: r.params, url: new URL(path, 'http://x') })));
  };
  /** @param {string} path */
  const stored = (path) => {
    const s = offline.stored(path);
    return s && gunzipSync(s.gz).toString('utf8');
  };

  assert.equal(offline.stored('/api/toc'), null, 'nothing before the first build');
  await offline.current();
  assert.equal(stored('/api/toc'), await live('/api/toc'));
  assert.equal(stored('/api/papers/5'), await live('/api/papers/5'));
  const before = offline.stored('/api/papers/5')?.hash;

  // the English text from its source changes a title: the stored answers wait for the new build
  const sync = createTextSync(db, {
    onChange: () => (book.forget(), offline.invalidate()),
    fetch: /** @type {any} */ (async () => ({
      status: 200, ok: true, headers: new Headers(),
      json: async () => ({ api: 1, version: 2, parts: [], papers: [{ paper: 5, part: 1, title: 'New title' }], sections: [], paragraphs: [], removed: { parts: [], papers: [], sections: [], paragraphs: [] } }),
    })),
  });
  assert.equal((await sync.run('manual')).status, 'ok');
  assert.equal(offline.stored('/api/papers/5'), null, 'not the old text while the new is made');
  assert.match(await live('/api/toc'), /New title/, 'the contents read anew');
  await offline.current();
  await new Promise((r) => setTimeout(r, 50)); // (the rebuild started by invalidate)
  assert.match(stored('/api/toc') ?? '', /New title/);
  assert.notEqual(offline.stored('/api/papers/5')?.hash, before);
});
