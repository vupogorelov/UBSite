// @ts-check
// Search execution. FTS5 narrows candidates for word clauses; clauses with regular expressions,
// filters, facets and highlight ranges are computed in JS over the in-memory book text.
import { tokenize, foldForRegex, findFleetingAliases, setStemAliases } from './text.js';
import { parseQuery, QueryError } from './query.js';
import { transaction } from '../db.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./query.js').Atom} Atom */
/** @typedef {import('./query.js').WordsAtom} WordsAtom */
/** @typedef {import('./query.js').Query} Query */
/** @typedef {import('./text.js').Token} Token */
/**
 * @typedef {{
 *   seq: number, ref: string, paperId: number, sectionNum: number, partId: number,
 *   ru: string, en: string, paperTitle: string, sectionTitle: string | null
 * }} Para
 * @typedef {{ lang: 'ru' | 'en', start: number, end: number, i: number, iEnd: number }} Hit
 * @typedef {[text: string, mark: 0 | 1][]} Segments
 */

// Bump when tokenization or stemming changes: the index is rebuilt on the next start.
export const SEARCH_INDEX_VERSION = '3';

const setMeta = (/** @type {DatabaseSync} */ db, /** @type {string} */ key, /** @type {string} */ value) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
const getMeta = (/** @type {DatabaseSync} */ db, /** @type {string} */ key) =>
  /** @type {{ value: string } | undefined} */ (db.prepare('SELECT value FROM meta WHERE key = ?').get(key))?.value;

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

/** @param {'ru' | 'en' | 'both'} lang @returns {('ru' | 'en')[]} */
const langsOf = (lang) => (lang === 'both' ? ['ru', 'en'] : [lang]);

/** @param {WordsAtom} a */
const usesExact = (a) => a.exact || a.prefix;

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
  if (a.kind === 'near') {
    const exact = usesExact(a.atoms[0]);
    if (a.atoms.some((x) => usesExact(x) !== exact)) {
      throw new QueryError('В «РЯДОМ» нельзя смешивать точные формы (=, *) и обычные слова');
    }
    return `${ftsColumn(a.lang, exact)} : NEAR(${a.atoms.map(ftsPhrase).join(' ')}, ${a.distance})`;
  }
  throw new Error('regex atoms are evaluated in JS');
}

/** @param {Token} tok @param {import('./query.js').Word} w @param {boolean} exact @param {boolean} prefix */
function wordMatches(tok, w, exact, prefix) {
  if (prefix) return tok.norm.startsWith(w.norm);
  return exact ? tok.norm === w.norm : tok.stem === w.stem;
}

/** Tokens between two hits (0 when adjacent or overlapping). @param {Hit} a @param {Hit} b */
const gap = (a, b) => Math.max(0, Math.max(a.i, b.i) - Math.min(a.iEnd, b.iEnd) - 1);

/** @param {DatabaseSync} db */
export function createSearch(db) {
  if (getMeta(db, 'search_index_version') !== SEARCH_INDEX_VERSION) {
    const t = performance.now();
    const aliases = transaction(db, () => buildSearchIndex(db));
    console.log(`Search index rebuilt in ${Math.round(performance.now() - t)} ms (${aliases} fleeting-vowel stem merges)`);
  } else {
    setStemAliases(new Map(JSON.parse(getMeta(db, 'ru_stem_aliases') ?? '[]')));
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

  /** @type {Map<string, Token[]>} */
  const tokenCache = new Map();
  /** @param {Para} p @param {'ru' | 'en'} lang */
  function tokensOf(p, lang) {
    const key = `${p.seq}${lang}`;
    let toks = tokenCache.get(key);
    if (!toks) {
      toks = tokenize(p[lang]);
      if (tokenCache.size > 5000) tokenCache.delete(/** @type {string} */ (tokenCache.keys().next().value));
      tokenCache.set(key, toks);
    }
    return toks;
  }

  /**
   * Every place where the atom matches in the paragraph.
   * @param {Atom} a @param {Para} p @returns {Hit[]}
   */
  function hits(a, p) {
    /** @type {Hit[]} */
    const out = [];
    if (a.kind === 'regex') {
      for (const lang of langsOf(a.lang)) {
        a.regex.lastIndex = 0;
        for (const m of foldForRegex(p[lang]).matchAll(a.regex)) {
          if (m[0].length) out.push({ lang, start: m.index, end: m.index + m[0].length, i: 0, iEnd: 0 });
          if (out.length > 2000) break;
        }
      }
      return out;
    }
    if (a.kind === 'words') {
      const n = a.words.length;
      for (const lang of langsOf(a.lang)) {
        const toks = tokensOf(p, lang);
        for (let i = 0; i + n <= toks.length; i++) {
          let ok = true;
          for (let j = 0; j < n && ok; j++) ok = wordMatches(toks[i + j], a.words[j], a.exact || a.prefix, a.prefix && j === n - 1);
          if (ok) out.push({ lang, start: toks[i].start, end: toks[i + n - 1].end, i, iEnd: i + n - 1 });
        }
      }
      return out;
    }
    // near: keep occurrences that have an occurrence of every other atom close enough
    const lists = a.atoms.map((x) => hits(x, p));
    lists.forEach((list, k) => {
      for (const h of list) {
        const close = lists.every((other, m) => m === k || other.some((o) => o.lang === h.lang && gap(h, o) <= a.distance));
        if (close) out.push(h);
      }
    });
    return lists[0].some((h) => out.includes(h)) ? out : [];
  }

  /** @type {Map<string, { seqs: number[], facets: Record<number, number> }>} */
  const resultCache = new Map();

  /**
   * @typedef {{ tagRefs: (name: string) => Set<string> }} SearchContext
   * @param {Query} q @param {SearchContext} ctx
   */
  function evaluate(q, ctx) {
    /** @type {string[]} */ const pos = [];
    /** @type {string[]} */ const neg = [];
    /** @type {import('./query.js').Clause[]} */ const jsClauses = [];
    for (const c of q.clauses) {
      if (c.alts.some((a) => a.kind === 'regex')) jsClauses.push(c);
      else (c.neg ? neg : pos).push(`(${c.alts.map(ftsAtom).join(' OR ')})`);
    }
    /** @param {string} expr */
    const runFts = (expr) => {
      try {
        return new Set(ftsMatch.all(expr).map((r) => /** @type {number} */ (r.seq)));
      } catch (err) {
        throw new QueryError(`Не удалось выполнить запрос: ${/** @type {Error} */ (err).message}`);
      }
    };

    let candidates = paras;
    if (pos.length) {
      let expr = `(${pos.join(' AND ')})`;
      for (const n of neg) expr = `(${expr} NOT ${n})`;
      const found = runFts(expr);
      candidates = paras.filter((p) => found.has(p.seq));
    } else if (neg.length) {
      const excluded = runFts(neg.join(' OR '));
      candidates = paras.filter((p) => !excluded.has(p.seq));
    }

    const inPapers = q.papers;
    const inSections = q.sections;
    // Tag filters: each group is a set of refs (union of its alternatives); all groups must contain the ref.
    const tagGroups = q.tags.map((group) => new Set(group.flatMap((name) => [...ctx.tagRefs(name)])));
    const tagExcluded = new Set(q.excludeTags.flatMap((name) => [...ctx.tagRefs(name)]));
    const matched = candidates.filter(
      (p) =>
        tagGroups.every((g) => g.has(p.ref)) &&
        !tagExcluded.has(p.ref) &&
        (!inPapers || inPapers.some(([a, b]) => p.paperId >= a && p.paperId <= b)) &&
        (!inSections || inSections.some((s) => p.paperId === s.paper && p.sectionNum >= s.from && p.sectionNum <= s.to)) &&
        jsClauses.every((c) => c.alts.some((a) => hits(a, p).length > 0) !== c.neg),
    );

    // Part counts ignore the part filter so the other parts stay visible as options.
    /** @type {Record<number, number>} */
    const facets = {};
    for (const p of matched) facets[p.partId] = (facets[p.partId] ?? 0) + 1;
    const parts = q.parts;
    return { seqs: (parts ? matched.filter((p) => parts.has(p.partId)) : matched).map((p) => p.seq), facets };
  }

  /** @param {string} text @param {SearchContext} ctx */
  function run(text, ctx) {
    const key = text.trim();
    const query = parseQuery(key);
    // Tag filters depend on notes, which change at any time: such queries are not cached.
    const cacheable = !query.tags.length && !query.excludeTags.length;
    const cached = cacheable ? resultCache.get(key) : undefined;
    if (cached) return { query, ...cached };
    const result = evaluate(query, ctx);
    if (cacheable) {
      if (resultCache.size >= 30) resultCache.delete(/** @type {string} */ (resultCache.keys().next().value));
      resultCache.set(key, result);
    }
    return { query, ...result };
  }

  /** Merged highlight ranges per language for all positive atoms. @param {Query} q @param {Para} p */
  function highlightRanges(q, p) {
    /** @type {{ ru: [number, number][], en: [number, number][] }} */
    const out = { ru: [], en: [] };
    for (const c of q.clauses) {
      if (c.neg) continue;
      for (const a of c.alts) for (const h of hits(a, p)) out[h.lang].push([h.start, h.end]);
    }
    for (const lang of /** @type {const} */ (['ru', 'en'])) {
      const sorted = out[lang].sort((x, y) => x[0] - y[0] || y[1] - x[1]);
      /** @type {[number, number][]} */
      const merged = [];
      for (const r of sorted) {
        const last = merged.at(-1);
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      out[lang] = merged;
    }
    return out;
  }

  const bySeq = new Map(paras.map((p) => [p.seq, p]));

  return {
    /** @param {string} text @param {number} offset @param {number} limit @param {SearchContext} ctx */
    search(text, offset, limit, ctx) {
      const { query, seqs, facets } = run(text, ctx);
      const results = seqs.slice(offset, offset + limit).map((seq) => {
        const p = /** @type {Para} */ (bySeq.get(seq));
        const hl = highlightRanges(query, p);
        return {
          ref: p.ref,
          paperId: p.paperId,
          sectionNum: p.sectionNum,
          paperTitle: p.paperTitle,
          sectionTitle: p.sectionTitle,
          ru: snippet(p.ru, hl.ru),
          en: snippet(p.en, hl.en),
        };
      });
      return {
        total: seqs.length,
        facets,
        // All matching refs (book order) for the reader's previous/next navigation.
        refs: offset === 0 ? seqs.map((s) => /** @type {Para} */ (bySeq.get(s)).ref) : undefined,
        results,
      };
    },

    /** @param {string} text @param {number} paperId @param {SearchContext} ctx */
    highlights(text, paperId, ctx) {
      const { query, seqs } = run(text, ctx);
      /** @type {Record<string, { ru: [number, number][], en: [number, number][] }>} */
      const out = {};
      for (const seq of seqs) {
        const p = /** @type {Para} */ (bySeq.get(seq));
        if (p.paperId === paperId) out[p.ref] = highlightRanges(query, p);
      }
      return out;
    },
  };
}

/**
 * A window of the paragraph around the first match, as text/mark segments.
 * @param {string} text @param {[number, number][]} ranges @param {number} [size]
 * @returns {Segments}
 */
export function snippet(text, ranges, size = 300) {
  let start = 0;
  let end = Math.min(text.length, size);
  if (ranges.length && ranges[0][1] > end) {
    start = Math.max(0, ranges[0][0] - 100);
    end = Math.min(text.length, start + size);
  }
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start) end = space;
  }
  /** @type {Segments} */
  const out = [];
  let pos = start;
  for (const [s, e] of ranges) {
    if (e <= start) continue;
    if (s >= end) break;
    const a = Math.max(s, start);
    const b = Math.min(e, end);
    if (a > pos) out.push([text.slice(pos, a), 0]);
    out.push([text.slice(a, b), 1]);
    pos = b;
  }
  if (pos < end) out.push([text.slice(pos, end), 0]);
  if (start > 0) out.unshift(['…', 0]);
  if (end < text.length) out.push(['…', 0]);
  return out;
}
