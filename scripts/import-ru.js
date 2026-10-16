// @ts-check
// Usage: node scripts/import-ru.js [path/to/UF-RUS-001-1997-1.5.md] [--write [--clean]]
// Replaces the Russian text of the book — paragraphs, paper and section titles — with another
// translation; the English text and the paragraph references stay. Page references are taken from
// the new file (they are finer there).
// Paragraphs are matched in order within each section, not by the file's numbers: the new file gives
// numbers to "* * *" separators (144:5, 134:6) and numbers the joint section "9 и 10" of paper 139
// as 10 where the book's references use 9.
// Without --write only the comparison report is printed (nothing is changed).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRu } from './lib/parse-ru.js';
import { openDb, transaction } from '../server/db.js';
import { buildSearchIndex } from '../server/search/engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const write = args.includes('--write');
/** --clean: also delete everything people created (notes, proposals, messages, collections, tasks…). */
const clean = args.includes('--clean');
const CONTENT = [
  'votes', 'proposal_versions', 'message_reactions', 'mentions', 'public_messages', 'proposals',
  'thread_follows', 'chat_reads', 'annotation_tags', 'comments', 'annotations', 'tags',
  'collection_items', 'collection_subscriptions', 'collections', 'subtasks', 'tasks', 'task_lists',
  'glossary', 'saved_queries', 'search_history',
];
const source = resolve(args.find((a) => !a.startsWith('--')) ?? resolve(root, 'UF-RUS-001-1997-1.5.md'));

/** The book's section → the file's section, where they differ. */
const SECTION_IN_FILE = /** @type {Record<string, string>} */ ({ '139:9': '139:10' });

const ru = parseRu(readFileSync(source, 'utf8'));
const db = openDb();
const rows = /** @type {{ ref: string, paper_id: number, section_num: number, page_ref: string }[]} */ (
  db.prepare('SELECT ref, paper_id, section_num, page_ref FROM paragraphs ORDER BY seq').all()
);
const papers = /** @type {{ id: number }[]} */ (db.prepare('SELECT id FROM papers').all());
const sections = /** @type {{ paper_id: number, num: number }[]} */ (db.prepare('SELECT paper_id, num FROM sections WHERE num > 0').all());

/** @type {Map<string, { html: string, plain: string, page: string | null, from: string }>} */
const matched = new Map();
/** @type {string[]} */ const problems = [];
/** @type {string[]} */ const renumbered = [];
/** The book's references corrected to the file's: [old, new]. @type {[string, string][]} */ const renames = [];
for (const [key, list] of Map.groupBy(rows, (r) => `${r.paper_id}:${r.section_num}`)) {
  const fileKey = SECTION_IN_FILE[key] ?? key;
  const entries = ru.sections.get(fileKey) ?? [];
  const labelled = entries.filter((e) => e.label);
  // Matched in order. Where the file has the same numbers in a different order, the old source had
  // them wrong (121:8: the English "[Acknowledgment…]" stood as 8.14 before 8.12 and 8.13): the
  // order is right, the book's numbers are corrected to the file's.
  const sameSet = labelled.length === list.length && list.every((r) => labelled.some((e) => e.anchor === r.ref));
  const use = labelled.length === list.length ? labelled : entries.length === list.length ? entries : null;
  if (!use) {
    problems.push(`${key}: ${list.length} paragraphs in the book, ${labelled.length} (+${entries.length - labelled.length} unlabelled) in the file`);
    continue;
  }
  list.forEach((r, i) => {
    const e = use[i];
    matched.set(r.ref, { html: e.html, plain: e.plain, page: e.page, from: e.anchor });
    if (e.anchor !== r.ref && sameSet) renames.push([r.ref, e.anchor]);
    else if (e.anchor !== r.ref) renumbered.push(`${r.ref}←${e.anchor}`);
  });
}
const empty = [...matched].filter(([, p]) => !p.plain.trim()).map(([ref]) => ref);
const pages = rows.filter((r) => matched.get(r.ref)?.page && matched.get(r.ref)?.page !== r.page_ref).length;
const noPaperTitle = papers.filter((p) => !ru.papers.has(p.id)).map((p) => p.id);
const noTitle = sections.filter((s) => !ru.titles.has(SECTION_IN_FILE[`${s.paper_id}:${s.num}`] ?? `${s.paper_id}:${s.num}`));

console.log(`Source:            ${source}`);
console.log(`Matched:           ${matched.size} of ${rows.length} paragraphs`);
console.log(`Not matched:       ${problems.length ? problems.join('; ') : 'none'}`);
console.log(`Other numbers:     ${renumbered.length}${renumbered.length ? ' — ' + renumbered.slice(0, 12).join(', ') + (renumbered.length > 12 ? ' …' : '') : ''}`);
console.log(`Refs corrected:    ${renames.length ? renames.map(([a, b]) => `${a}→${b}`).join(', ') : 'none'}`);
console.log(`Empty:             ${empty.length ? empty.join(', ') : 'none'}`);
console.log(`Page refs updated: ${pages}`);
console.log(`Paper titles:      ${papers.length - noPaperTitle.length}/${papers.length}`);
console.log(`Section titles:    ${sections.length - noTitle.length}/${sections.length}`);
console.log(`Parser issues:     ${ru.issues.length}${ru.issues.length ? ' — ' + ru.issues.slice(0, 5).map((i) => `line ${i.line}: ${i.message}`).join('; ') : ''}`);

if (!write) {
  console.log('\nDry run — nothing changed. Add --write to replace the Russian text.');
  process.exit(0);
}
if (problems.length || empty.length || ru.issues.length) {
  console.error('\nNot every paragraph matched — database not modified.');
  process.exit(1);
}

transaction(db, () => {
  const upd = db.prepare('UPDATE paragraphs SET html_ru = ?, plain_ru = ?, page_ref = coalesce(?, page_ref) WHERE ref = ?');
  for (const [ref, p] of matched) upd.run(p.html, p.plain, p.page, ref);
  // Corrected references, through temporary names (the new names are still taken by other rows).
  const ren = db.prepare('UPDATE paragraphs SET ref = ?, num = ? WHERE ref = ?');
  for (const [from] of renames) ren.run(`tmp:${from}`, 0, from);
  for (const [from, to] of renames) ren.run(to, Number(to.split('.')[1]), `tmp:${from}`);
  if (clean) {
    // Everything people created over the text goes (children first). Accounts, workspaces, members,
    // invites, settings and channels stay.
    for (const t of CONTENT) {
      const n = /** @type {{ n: number }} */ (db.prepare(`SELECT count(*) n FROM ${t}`).get()).n;
      db.exec(`DELETE FROM ${t}`);
      if (n) console.log(`  cleared ${t}: ${n}`);
    }
    db.exec('UPDATE users SET notif_seen_id = 0');
  }
  // titles are plain text: the source's line breaks in them become ". " (after a dash — a space)
  /** @param {string} t */
  const plainTitle = (t) => t.replace(/\s*([–—])\s*<br\s*\/?>\s*/g, ' $1 ').replace(/\s*<br\s*\/?>\s*/g, '. ');
  const updPaper = db.prepare('UPDATE papers SET title_ru = ? WHERE id = ?');
  for (const [id, title] of ru.papers) updPaper.run(plainTitle(title), id);
  const updSection = db.prepare('UPDATE sections SET title_ru = ? WHERE paper_id = ? AND num = ?');
  for (const s of sections) {
    const title = ru.titles.get(SECTION_IN_FILE[`${s.paper_id}:${s.num}`] ?? `${s.paper_id}:${s.num}`);
    if (title) updSection.run(plainTitle(title), s.paper_id, s.num);
  }
});
console.log('\nRussian text replaced. Rebuilding the search index…');
buildSearchIndex(db);
console.log('Done.');
