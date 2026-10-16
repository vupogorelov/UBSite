// @ts-check
// Search without a network gives what the server gives (VISION.md, 11; TODO.md "Без сети").
//
//   npm run check:offline                 the database in data/ (only read)
//   UB_DB=<path> npm run check:offline    another one
//
// Two engines over the same book: the server's (SQLite FTS5 + the shared core) and the device's (the
// shared core + the JS word filter), the latter fed with the very answers the device keeps (/api/toc,
// /api/papers/:id, /api/stem-aliases, produced by the route handlers). For every query — a fixed list
// and the people's own (saved queries and history) — the answers must be equal: the count, the part
// counts, the paragraphs in order, the snippets with their marks, the highlights in a paper, or the
// same error. "Go to" (5:1.3, 62.3) is compared too. Queries with tag filters are skipped: without
// a network they are not offered.
import { openDb } from '../server/db.js';
import { createRouter } from '../server/http.js';
import { registerBookRoutes } from '../server/api/book.js';
import { createSearch } from '../server/search/engine.js';
import { createSearchCore } from '../shared/search/core.js';
import { createWordFilter, buildWordIndex, packWordIndex, unpackWordIndex } from '../shared/search/fts.js';
import { bookFromCopy, gotoPath } from '../shared/search/offline-data.js';

const db = openDb(process.env.UB_DB || undefined);
const router = createRouter();
registerBookRoutes(router, db);

/** An answer as the device receives it (serialized, as sendJson writes it). @param {string} url */
async function answer(url) {
  const u = new URL(url, 'http://localhost');
  const route = router.match('GET', u.pathname);
  if (!route) throw new Error(`No route for ${url}`);
  try {
    const data = await route.handler({ req: /** @type {any} */ (null), res: /** @type {any} */ (null), params: route.params, url: u, user: /** @type {any} */ (null) });
    return JSON.parse(JSON.stringify(data ?? null));
  } catch (err) {
    return { error: /** @type {Error} */ (err).message };
  }
}

const t0 = performance.now();
const server = createSearch(db); // (sets the stem merges from the database)
const toc = await answer('/api/toc');
const papers = await Promise.all(toc.papers.map((/** @type {{ id: number }} */ p) => answer(`/api/papers/${p.id}`)));
const book = bookFromCopy(toc, papers);
// (the word index as the device keeps it: built, packed, read back)
const kept = unpackWordIndex(/** @type {ArrayBuffer} */ (packWordIndex(buildWordIndex(book.paras)).buffer));
const device = createSearchCore(book.paras, createWordFilter(book.paras, kept));
console.log(`Engines ready in ${Math.round(performance.now() - t0)} ms: ${book.paras.length} paragraphs`);

const ctx = { tagRefs: () => new Set() };
const FIXED = [
  'Бог', 'бога', '=Бога', 'отец', 'отца', 'любовь', 'любви', 'Отец', 'Иисус', 'Михаил', 'Небадон', 'Хавона', 'Рай', 'Адам',
  'Мелхиседек', 'Настройщик Мысли', '"Настройщик Мысли"', '="Настройщики Мысли"', 'Настрой*', '"всеобщий отец"*', 'всеобщ*',
  'вечный сын', '"Вечный Сын"', 'бог -отец', 'бог НЕ отец', '-бог', 'бог | отец', 'бог ИЛИ дух', 'дух OR душа', 'бог ~3 любовь',
  'бог РЯДОМ/2 любовь', 'бог NEAR/0 отец', 'Иисус ~5 Петр ~5 Иоанн', '"сын человеческий" ~4 бог', '=бога ~3 =отца',
  'бог ~3 =отца', '/бог\\w*/', '/Бог[аеу]/i', '/\\bлюбов/', 'бог /\\d{3}/', 'часть:1 бог', 'часть:4 Иисус', 'текст:5 бог',
  'текст:100-120 любовь', 'раздел:5:1 бог', 'язык:en God', 'язык:en Father', 'God', 'love', 'loves', 'Father’s', "don't",
  'язык:оба God', 'язык:оба Бог', 'Thought Adjuster', '"Thought Adjuster"', 'Adjust*', 'God ~3 love', 'Jesus -Peter',
  'cангиков', 'ребенок', 'ребенка', 'огонь', 'огня', 'ангел', 'ангела', 'ёлка', 'елка', 'вселенная вселенных', 'Уверса',
  'Орвонтон', 'Сатания', 'Урантия', '1934', '12', 'x', 'я', 'и', 'не', '"и не"', 'а*', '*', '""', '"', '~', 'НЕ', '-', '|',
  'бог |', '/(/', '/a+/', 'текст:999 бог', 'часть:9', 'текст:5', 'раздел:5:1', 'язык:ru', 'Бог есть дух', '"Бог есть дух"',
];
/** @param {string} sql */
const rows = (sql) => {
  try {
    return /** @type {{ query: string }[]} */ (db.prepare(sql).all()).map((r) => r.query);
  } catch {
    return [];
  }
};
const people = [...rows('SELECT query FROM saved_queries'), ...rows('SELECT query FROM search_history_v2'), ...rows('SELECT query FROM search_history')];
const queries = [...new Set([...FIXED, ...people])].filter((q) => !/(^|\s)(-?(тег|tag):|#)/i.test(q));

/** @param {() => unknown} fn */
function outcome(fn) {
  try {
    return JSON.stringify(fn());
  } catch (err) {
    return `ERROR ${/** @type {Error} */ (err).message}`;
  }
}

let same = 0;
/** @type {string[]} */
const diffs = [];
for (const q of queries) {
  const a = outcome(() => server.search(q, 0, 50, ctx));
  const b = outcome(() => device.search(q, 0, 50, ctx));
  // highlights in the paper of the first result (the reader marks them in the text)
  const first = a.startsWith('{') ? JSON.parse(a).results[0]?.paperId : undefined;
  const ha = first === undefined ? '' : outcome(() => server.highlights(q, first, ctx));
  const hb = first === undefined ? '' : outcome(() => device.highlights(q, first, ctx));
  if (a === b && ha === hb) same++;
  else diffs.push(`«${q}»: server ${a.slice(0, 120)} | device ${b.slice(0, 120)}${ha !== hb ? ' (highlights differ)' : ''}`);
}

// "Go to"
const GOTO = ['5', '5:1', '5:1.3', '0:0.1', '196:3.5', '62.3', '(62.3)', '1.1', '999', '5:99', '5:1.999', 'abc', ' 5:1.3 ', '05:01.03', '1000.1'];
for (const p of book.paras.filter((_, i) => i % 97 === 0)) GOTO.push(p.ref, p.ref.split('.')[0], String(p.paperId));
let gotoSame = 0;
for (const q of GOTO) {
  const a = JSON.stringify(await answer(`/api/goto?q=${encodeURIComponent(q)}`));
  const b = JSON.stringify((() => {
    try {
      return gotoPath(book, q);
    } catch (err) {
      return { error: /** @type {Error} */ (err).message };
    }
  })());
  if (a === b) gotoSame++;
  else diffs.push(`go to «${q}»: server ${a} | device ${b}`);
}

console.log(`Search: ${same} of ${queries.length} queries the same (${people.length} of them people's own, before removing repeats)`);
console.log(`Go to: ${gotoSame} of ${GOTO.length} the same`);
for (const d of diffs.slice(0, 30)) console.log('  ✗', d);
if (diffs.length > 30) console.log(`  … and ${diffs.length - 30} more`);
process.exit(diffs.length ? 1 : 0);
