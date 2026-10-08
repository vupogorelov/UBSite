// @ts-check
// Usage: node scripts/import-book.js [path/to/book.md]
// Parses the book, prints a validation report and replaces the book tables in the database.
// Refuses to write when the parser reports errors.
// The Russian text of the book now comes from another translation: after this script run
// `node scripts/import-ru.js --write` (UF-RUS-001-1997-1.5.md), or the old translation comes back.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBook } from './lib/parse-book.js';
import { openDb, transaction, DEFAULT_DB_PATH } from '../server/db.js';
import { buildSearchIndex } from '../server/search/engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = resolve(process.argv[2] ?? resolve(root, 'UB-USGNY-EN-RUS-001-2017.md'));

const started = performance.now();
const book = parseBook(readFileSync(source, 'utf8'));
if (book.parts.length !== 4) {
  book.issues.push({ line: 0, level: 'error', message: `Expected 4 parts, found ${book.parts.length}` });
}
if (book.papers.length !== 197) {
  book.issues.push({ line: 0, level: 'error', message: `Expected 197 papers (Foreword + 1–196), found ${book.papers.length}` });
}

const count = (/** @type {string} */ level) => book.issues.filter((i) => i.level === level).length;
const report = [
  `Source:     ${source}`,
  `Parts:      ${book.parts.length}`,
  `Papers:     ${book.papers.length}`,
  `Sections:   ${book.sections.length} (incl. ${book.papers.length} untitled intro sections)`,
  `Paragraphs: ${book.paragraphs.length}`,
  `Chars RU:   ${book.paragraphs.reduce((n, p) => n + p.plainRu.length, 0).toLocaleString('en')}`,
  `Chars EN:   ${book.paragraphs.reduce((n, p) => n + p.plainEn.length, 0).toLocaleString('en')}`,
  `Issues:     ${count('error')} errors, ${count('warning')} warnings, ${count('info')} info`,
  ...book.issues.map((i) => `  [${i.level}] line ${i.line}: ${i.message}`),
].join('\n');

const reportPath = resolve(dirname(DEFAULT_DB_PATH), 'import-report.txt');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report + '\n');
console.log(report);

if (count('error') > 0) {
  console.error('\nErrors found — database not modified.');
  process.exit(1);
}

const db = openDb();
transaction(db, () => {
  db.exec('DELETE FROM paragraphs; DELETE FROM sections; DELETE FROM papers; DELETE FROM parts;');
  const insPart = db.prepare('INSERT INTO parts (id, title_ru, title_en, subtitle_ru) VALUES (?, ?, ?, ?)');
  for (const p of book.parts) insPart.run(p.id, p.titleRu, p.titleEn, p.subtitleRu);
  const insPaper = db.prepare('INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (?, ?, ?, ?)');
  for (const p of book.papers) insPaper.run(p.id, p.partId, p.titleRu, p.titleEn);
  const insSection = db.prepare('INSERT INTO sections (paper_id, num, title_ru, title_en) VALUES (?, ?, ?, ?)');
  for (const s of book.sections) insSection.run(s.paperId, s.num, s.titleRu, s.titleEn);
  const insPara = db.prepare(
    `INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of book.paragraphs) {
    insPara.run(p.ref, p.seq, p.paperId, p.sectionNum, p.num, p.pageRef, p.htmlRu, p.htmlEn, p.plainRu, p.plainEn);
  }
  buildSearchIndex(db);
});
db.close();

console.log(`\nImported into ${DEFAULT_DB_PATH} in ${Math.round(performance.now() - started)} ms`);
console.log(`Report saved to ${reportPath}`);
console.log('Restart the server to pick up the new text.');
