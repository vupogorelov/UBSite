// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createTextSync, plainOf } from './textsync.js';

test('the English text from its source: changes applied and reported, nothing removed, 304 is "unchanged"', async () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Old title');
    INSERT INTO sections (paper_id, num, title_ru, title_en) VALUES (5, 1, 'Раздел', 'Section');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en) VALUES
      ('5:1.1', 1, 5, 1, 1, '62.1', 'а', 'The Father is love.', 'а', 'The Father is love.'),
      ('5:1.2', 2, 5, 1, 2, '62.2', 'б', 'Jesus said so.', 'б', 'Jesus said so.'),
      ('5:1.3', 3, 5, 1, 3, '62.3', 'в', 'Unchanged.', 'в', 'Unchanged.');
  `);
  /** @type {{ status: number, body?: any, etag?: string }[]} */
  const replies = [];
  /** @type {string[]} */ const asked = [];
  /** @type {any} */
  const fakeFetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    asked.push(`${url} ${init.headers['If-None-Match'] ?? ''}`.trim());
    const r = /** @type {any} */ (replies.shift());
    return { status: r.status, ok: r.status < 400, json: async () => r.body, headers: new Headers(r.etag ? { etag: r.etag } : {}) };
  };
  const sync = createTextSync(db, { fetch: fakeFetch });
  assert.equal(sync.config().enabled, false); // off until an administrator turns it on

  replies.push({
    status: 200, etag: '"v3"',
    body: {
      api: 1, version: 3, full: true, made: '2026-10-11', licence: { credit_line: 'Text: the Uversa Press edition' },
      parts: [], papers: [{ paper: 5, part: 1, title: 'The Universal Father' }], sections: [],
      paragraphs: [
        { ref: '5:1.1', uf_ref: '5:1.1', html: 'The Father is <em>love</em>.' }, // markup only
        { ref: '5:1.2', uf_ref: '5:1.2', html: '<span class="jesus">Jesus said it so.</span>' }, // the text
        { ref: '5:1.3', uf_ref: '5:1.3', html: 'Unchanged.' },
        { ref: '9:9.9', uf_ref: '9:9.9', html: 'Not ours.' },
      ],
      removed: { parts: [], papers: [], sections: [], paragraphs: ['5:1.0'] },
    },
  });
  const first = await sync.run('manual');
  assert.equal(first.status, 'ok');
  assert.deepEqual([first.markupOnly, first.textChanged, first.notOurs, first.titles, first.removedThere], [1, 1, 1, 1, 1]);
  assert.equal(first.samples?.[0].ref, '5:1.2');
  const p = /** @type {any} */ (db.prepare("SELECT html_en, plain_en, uf_ref FROM paragraphs WHERE ref = '5:1.2'").get());
  assert.equal(p.plain_en, 'Jesus said it so.');
  assert.equal(p.uf_ref, '5:1.2');
  assert.equal(/** @type {any} */ (db.prepare('SELECT title_en FROM papers WHERE id = 5').get()).title_en, 'The Universal Father');
  assert.equal(sync.config().version, 3);

  // the next time: from version 3, with the ETag; 304 — nothing changed
  replies.push({ status: 304 });
  assert.equal((await sync.run('schedule')).status, 'unchanged');
  assert.match(asked[1], /since=3 "v3"$/);

  // the source fails — reported, the version kept
  replies.push({ status: 500 });
  const failed = await sync.run('manual');
  assert.equal(failed.status, 'error');
  assert.equal(sync.config().version, 3);
  assert.deepEqual(sync.runs().map((r) => r.status), ['error', 'unchanged', 'ok']);

  // the schedule: off — nothing; on — not before its interval
  assert.equal(await sync.tick(), null);
  sync.setConfig({ enabled: true, intervalHours: 24 });
  assert.equal(await sync.tick(Date.now() + 3_600_000), null);
  assert.equal(plainOf('a &lt;b&gt; &amp; <em>c</em>'), 'a <b> & c');
});
