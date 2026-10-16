// @ts-check
// The first selection by words on the device — what SQLite FTS5 does on the server (search_fts:
// columns ru_exact, ru_stem, en_exact, en_stem of pre-tokenized words, tokenizer unicode61), done in
// JS over the same tokens: a term or a phrase is consecutive tokens (forms or stems), "phrase"* — the
// last token begins so, a column set {ru en} — either language, NEAR(p1 p2…, N) — an occurrence of
// every phrase in one column with at most N tokens between the end of the first and the start of the
// last. scripts/check-offline.js compares it with FTS5 on many queries.
import { WORD, normalizeWord, stemWord } from './text.js';
import { langsOf, usesExact } from './core.js';

/** @typedef {import('./core.js').Para} Para */
/** @typedef {import('./query.js').Atom} Atom */
/** @typedef {import('./query.js').WordsAtom} WordsAtom */
/** @typedef {import('./query.js').Clause} Clause */
/** A paragraph's language as numbers: the id of each token's form and stem. @typedef {{ norm: Int32Array, stem: Int32Array }} Column */
/**
 * A phrase made ready: per token, the ids it may be (a Set for the prefix) — or null when some word
 * is not in the book at all.
 * @typedef {{ exact: boolean, terms: (number | Set<number>)[] } | null} Phrase
 */

/**
 * The book's words as numbers: the forms and stems (their ids are their places in `norms`, `stems`),
 * and every paragraph's tokens — paragraph i in Russian is column 2i, in English 2i+1; its tokens are
 * `norm`/`stem` from offsets[k] to offsets[k + 1]. Built once (a second on a computer, several on a
 * phone) and kept on the device (packWordIndex), so that search without a network starts at once.
 * @typedef {{ norms: string[], stems: string[], offsets: Int32Array, norm: Int32Array, stem: Int32Array }} WordIndex
 */

/** @param {Para[]} paras @returns {WordIndex} */
export function buildWordIndex(paras) {
  /** @type {Map<string, number>} */ const normIds = new Map();
  /** @type {Map<string, number>} */ const stemIds = new Map();
  /** @param {Map<string, number>} ids @param {string} s */
  const idOf = (ids, s) => {
    let id = ids.get(s);
    if (id === undefined) ids.set(s, (id = ids.size));
    return id;
  };
  // ~2 million words, ~150 thousand different ones: each is normalized and stemmed once (as
  // tokenize() does it), then only looked up.
  /** @type {Map<string, [number, number]>} */
  const known = new Map();
  /** @type {number[]} */ const norm = [];
  /** @type {number[]} */ const stem = [];
  /** @type {number[]} */ const offsets = [0];
  /** @param {string} text */
  function column(text) {
    for (const m of text.matchAll(WORD)) {
      let ids = known.get(m[0]);
      if (!ids) {
        const w = normalizeWord(m[0]);
        ids = [idOf(normIds, w.norm), idOf(stemIds, stemWord(w.norm, w.script))];
        known.set(m[0], ids);
      }
      norm.push(ids[0]);
      stem.push(ids[1]);
    }
    offsets.push(norm.length);
  }
  for (const p of paras) column(p.ru), column(p.en);
  return { norms: [...normIds.keys()], stems: [...stemIds.keys()], offsets: Int32Array.from(offsets), norm: Int32Array.from(norm), stem: Int32Array.from(stem) };
}

/** The index as bytes to keep: [header length][header JSON][padding][offsets][norm][stem]. @param {WordIndex} ix */
export function packWordIndex(ix) {
  const head = new TextEncoder().encode(JSON.stringify({ norms: ix.norms, stems: ix.stems, sizes: [ix.offsets.length, ix.norm.length] }));
  const start = Math.ceil((4 + head.length) / 4) * 4;
  const out = new Uint8Array(start + (ix.offsets.length + ix.norm.length * 2) * 4);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  const ints = new Int32Array(out.buffer, start);
  ints.set(ix.offsets, 0);
  ints.set(ix.norm, ix.offsets.length);
  ints.set(ix.stem, ix.offsets.length + ix.norm.length);
  return out;
}

/** @param {ArrayBuffer} buf @returns {WordIndex} */
export function unpackWordIndex(buf) {
  const headLen = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headLen)));
  const start = Math.ceil((4 + headLen) / 4) * 4;
  const [nOff, nTok] = head.sizes;
  return {
    norms: head.norms,
    stems: head.stems,
    offsets: new Int32Array(buf, start, nOff),
    norm: new Int32Array(buf, start + nOff * 4, nTok),
    stem: new Int32Array(buf, start + (nOff + nTok) * 4, nTok),
  };
}

/** @param {Para[]} paras @param {WordIndex} [index] (built here if not given) @returns {import('./core.js').WordFilter} */
export function createWordFilter(paras, index = buildWordIndex(paras)) {
  const normIds = new Map(index.norms.map((s, i) => [s, i]));
  const stemIds = new Map(index.stems.map((s, i) => [s, i]));
  /** @param {number} k @returns {Column} */
  const column = (k) => ({
    norm: index.norm.subarray(index.offsets[k], index.offsets[k + 1]),
    stem: index.stem.subarray(index.offsets[k], index.offsets[k + 1]),
  });
  const cols = paras.map((_, i) => ({ ru: column(2 * i), en: column(2 * i + 1) }));
  const normList = index.norms;

  /** @param {WordsAtom} a @returns {Phrase} */
  function phrase(a) {
    const exact = usesExact(a);
    /** @type {(number | Set<number>)[]} */
    const terms = [];
    for (let j = 0; j < a.words.length; j++) {
      const w = a.words[j];
      if (a.prefix && j === a.words.length - 1) {
        const set = new Set();
        normList.forEach((n, id) => n.startsWith(w.norm) && set.add(id));
        if (!set.size) return null;
        terms.push(set);
      } else {
        const id = exact ? normIds.get(w.norm) : stemIds.get(w.stem);
        if (id === undefined) return null;
        terms.push(id);
      }
    }
    return { exact, terms };
  }

  /** Where the phrase starts in the column. @param {NonNullable<Phrase>} ph @param {Column} col */
  function starts(ph, col) {
    const ids = ph.exact ? col.norm : col.stem;
    const n = ph.terms.length;
    /** @type {number[]} */
    const out = [];
    for (let i = 0; i + n <= ids.length; i++) {
      let ok = true;
      for (let j = 0; j < n && ok; j++) {
        const t = ph.terms[j];
        ok = typeof t === 'number' ? ids[i + j] === t : t.has(ids[i + j]);
      }
      if (ok) out.push(i);
    }
    return out;
  }

  /**
   * NEAR: is there one occurrence of every phrase such that, from the earliest, at most `distance`
   * tokens lie between its end and the start of the latest.
   * @param {NonNullable<Phrase>[]} phs @param {Column} col @param {number} distance
   */
  function near(phs, col, distance) {
    const lists = phs.map((ph) => starts(ph, col));
    if (lists.some((l) => !l.length)) return false;
    for (let k = 0; k < phs.length; k++) {
      for (const first of lists[k]) {
        let last = first;
        let ok = true;
        for (let m = 0; m < phs.length && ok; m++) {
          if (m === k) continue;
          const next = lists[m].find((s) => s >= first);
          if (next === undefined) ok = false;
          else last = Math.max(last, next);
        }
        if (ok && last - first - phs[k].terms.length <= distance) return true;
      }
    }
    return false;
  }

  /**
   * The atom made ready: a test of a paragraph (by index), or null — matches nowhere.
   * @param {Atom} a @returns {((i: number) => boolean) | null}
   */
  function compile(a) {
    if (a.kind === 'words') {
      const ph = phrase(a);
      if (!ph) return null;
      const langs = langsOf(a.lang);
      return (i) => langs.some((lang) => starts(ph, cols[i][lang]).length > 0);
    }
    if (a.kind === 'near') {
      const phs = a.atoms.map(phrase);
      if (phs.some((p) => !p)) return null;
      const ready = /** @type {NonNullable<Phrase>[]} */ (phs);
      const langs = langsOf(a.lang);
      return (i) => langs.some((lang) => near(ready, cols[i][lang], a.distance));
    }
    throw new Error('regex atoms are evaluated in JS');
  }

  /** A clause: one of its alternatives. @param {Clause} c */
  function clause(c) {
    const tests = /** @type {((i: number) => boolean)[]} */ (c.alts.map(compile).filter(Boolean));
    return (/** @type {number} */ i) => tests.some((t) => t(i));
  }

  return (pos, neg) => {
    const yes = pos.map(clause);
    const no = neg.map(clause);
    /** @type {Set<number>} */
    const out = new Set();
    paras.forEach((p, i) => {
      if (yes.every((t) => t(i)) && !no.some((t) => t(i))) out.add(p.seq);
    });
    return out;
  };
}
