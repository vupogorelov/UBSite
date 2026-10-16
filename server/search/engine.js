// @ts-check
// Search execution on the server. SQLite FTS5 makes the first selection by words (terms, phrases,
// prefixes, NEAR); everything else — regular expressions, filters, part counts, highlights, snippets —
// is the shared search core (shared/search/core.js), which the device runs too without a network.
import { tokenize, findFleetingAliases, setStemAliases } from '../../shared/search/text.js';
import { QueryError } from '../../shared/search/query.js';
import { createSearchCore, usesExact, snippet } from '../../shared/search/core.js';
import { transaction } from '../db.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('../../shared/search/query.js').Atom} Atom */
/** @typedef {import('../../shared/search/query.js').WordsAtom} WordsAtom */
/** @typedef {import('../../shared/search/query.js').Clause} Clause */
/** @typedef {import('../../shared/search/core.js').Para} Para */

export { snippet };

// Bump when tokenization or stemming changes: the index is rebuilt on the next start.
export const SEARCH_INDEX_VERSION = '3';

const setMeta = (/** @type {DatabaseSync} */ db, /** @type {string} */ key, /** @type {string} */ value) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
const getMeta = (/** @type {DatabaseSync} */ db, /** @type {string} */ key) =>
  /** @type {{ value: string } | undefined} */ (db.prepare('SELECT value FROM meta WHERE key = ?').get(key))?.value;

/** The Russian stem merges (fleeting vowels) the index was built with: [long, short][]. @param {DatabaseSync} db */
export const stemAliases = (db) => /** @type {[string, string][]} */ (JSON.parse(getMeta(db, 'ru_stem_aliases') ?? '[]'));

/** @param {DatabaseSync} db */
export function buildSearchIndex(db) {
  const rows = /** @type {{ seq: number, plain_ru: string, plain_en: string }[]} */ (
    db.prepare('SELECT seq, plain_ru, plain_en FROM paragraphs').all()
  );
  const aliases = findFleetingAliases(rows.map((r) => r.plain_ru));
  setStemAliases(aliases);
  setMeta(db, 'ru_stem_aliases', JSON.stringify([...aliases]));

  db.exec("INSERT INTO search_fts (search_fts) VALUES ('delete-all')");
  const insert = db.prepare('INSERT INTO search_fts (rowid, ru_exact, ru_stem, en_exact, en_stem) VALUES (?, ?, ?, ?, ?)');
  for (const row of rows) {
    const ru = tokenize(row.plain_ru);
    const en = tokenize(row.plain_en);
    insert.run(
      row.seq,
      ru.map((t) => t.norm).join(' '),
      ru.map((t) => t.stem).join(' '),
      en.map((t) => t.norm).join(' '),
      en.map((t) => t.stem).join(' '),
    );
  }
  setMeta(db, 'search_index_version', SEARCH_INDEX_VERSION);
  return aliases.size;
}

/** @param {'ru' | 'en' | 'both'} lang @param {boolean} exact */
function ftsColumn(lang, exact) {
  const kind = exact ? 'exact' : 'stem';
  return lang === 'both' ? `{ru_${kind} en_${kind}}` : `${lang}_${kind}`;
}

/** @param {WordsAtom} a */
function ftsPhrase(a) {
  const terms = a.words.map((w) => (usesExact(a) ? w.norm : w.stem));
  return `"${terms.join(' ')}"${a.prefix ? '*' : ''}`;
}

/** @param {Atom} a */
function ftsAtom(a) {
  if (a.kind === 'words') return `${ftsColumn(a.lang, usesExact(a))} : ${ftsPhrase(a)}`;
  if (a.kind === 'near') return `${ftsColumn(a.lang, usesExact(a.atoms[0]))} : NEAR(${a.atoms.map(ftsPhrase).join(' ')}, ${a.distance})`;
  throw new Error('regex atoms are evaluated in JS');
}

/** @param {DatabaseSync} db */
export function createSearch(db) {
  if (getMeta(db, 'search_index_version') !== SEARCH_INDEX_VERSION) {
    const t = performance.now();
    const aliases = transaction(db, () => buildSearchIndex(db));
    console.log(`Search index rebuilt in ${Math.round(performance.now() - t)} ms (${aliases} fleeting-vowel stem merges)`);
  } else {
    setStemAliases(new Map(stemAliases(db)));
  }

  /** @type {Para[]} */
  const paras = /** @type {any[]} */ (
    db.prepare(
      `SELECT p.seq, p.ref, p.paper_id AS paperId, p.section_num AS sectionNum, pa.part_id AS partId,
              p.plain_ru AS ru, p.plain_en AS en, pa.title_ru AS paperTitle, s.title_ru AS sectionTitle
       FROM paragraphs p
       JOIN papers pa ON pa.id = p.paper_id
       LEFT JOIN sections s ON s.paper_id = p.paper_id AND s.num = p.section_num
       ORDER BY p.seq`,
    ).all()
  );
  const ftsMatch = db.prepare('SELECT rowid AS seq FROM search_fts WHERE search_fts MATCH ?');

  /** @param {string} expr */
  const runFts = (expr) => {
    try {
      return new Set(ftsMatch.all(expr).map((r) => /** @type {number} */ (r.seq)));
    } catch (err) {
      throw new QueryError(`Не удалось выполнить запрос: ${/** @type {Error} */ (err).message}`);
    }
  };
  /** @param {Clause} c */
  const clauseExpr = (c) => `(${c.alts.map(ftsAtom).join(' OR ')})`;

  return createSearchCore(paras, (pos, neg) => {
    if (pos.length) {
      let expr = `(${pos.map(clauseExpr).join(' AND ')})`;
      for (const n of neg) expr = `(${expr} NOT ${clauseExpr(n)})`;
      return runFts(expr);
    }
    const excluded = runFts(neg.map(clauseExpr).join(' OR '));
    return new Set(paras.filter((p) => !excluded.has(p.seq)).map((p) => p.seq));
  });
}
