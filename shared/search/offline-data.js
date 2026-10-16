// @ts-check
// The book for search without a network, made from the saved answers of the API (the device's copy,
// server/offline.js): the paragraphs as the server's search sees them, and "go to 5:1.3" / "62.3".
// The plain text is the HTML without its tags (the importer keeps them equal; the book has no
// character references) — so the copy needs no second text.

/** @typedef {import('./core.js').Para} Para */
/**
 * @typedef {{ parts: unknown[], papers: { id: number, partId: number }[] }} Toc
 * @typedef {{
 *   paper: { id: number, titleRu: string },
 *   sections: { num: number, titleRu: string | null }[],
 *   paragraphs: { ref: string, sectionNum: number, pageRef: string | null, ru: string, en: string }[],
 * }} PaperData
 * @typedef {{ paras: Para[], refs: Set<string>, sections: Set<string>, papers: Set<number>, byPage: Map<string, string> }} OfflineBook
 */

/** @param {string} html */
const plain = (html) => html.replace(/<[^>]*>/g, '');

/** @param {Toc} toc @param {PaperData[]} papers (in the order of the contents) @returns {OfflineBook} */
export function bookFromCopy(toc, papers) {
  const partOf = new Map(toc.papers.map((p) => [p.id, p.partId]));
  /** @type {Para[]} */
  const paras = [];
  /** @type {Map<string, string>} */
  const byPage = new Map();
  const sections = new Set();
  for (const d of papers) {
    const titles = new Map(d.sections.map((s) => [s.num, s.titleRu]));
    for (const s of d.sections) sections.add(`${d.paper.id}:${s.num}`);
    for (const p of d.paragraphs) {
      paras.push({
        seq: paras.length + 1,
        ref: p.ref,
        paperId: d.paper.id,
        sectionNum: p.sectionNum,
        partId: /** @type {number} */ (partOf.get(d.paper.id)),
        ru: plain(p.ru),
        en: plain(p.en),
        paperTitle: d.paper.titleRu,
        sectionTitle: titles.get(p.sectionNum) ?? null,
      });
      if (p.pageRef && !byPage.has(p.pageRef)) byPage.set(p.pageRef, p.ref);
    }
  }
  return { paras, refs: new Set(paras.map((p) => p.ref)), sections, papers: new Set(papers.map((d) => d.paper.id)), byPage };
}

/**
 * "5", "5:1", "5:1.3" or a page reference "62.3" / "(62.3)" → the app's path (as GET /api/goto).
 * @param {OfflineBook} book @param {string} q @returns {{ path: string }}
 */
export function gotoPath(book, q) {
  const text = q.trim();
  let m;
  if ((m = text.match(/^(\d+)(?::(\d+)(?:\.(\d+))?)?$/))) {
    const [, p, s, n] = m;
    if (n !== undefined && book.refs.has(`${+p}:${+s}.${+n}`)) return { path: `/${+p}:${+s}.${+n}` };
    if (n === undefined && s !== undefined && book.sections.has(`${+p}:${+s}`)) return { path: `/${+p}:${+s}` };
    if (s === undefined && book.papers.has(+p)) return { path: `/${+p}` };
  } else if ((m = text.match(/^\(?(\d+)\.(\d+)\)?$/))) {
    const ref = book.byPage.get(`${+m[1]}.${+m[2]}`);
    if (ref) return { path: `/${ref}` };
  }
  throw Object.assign(new Error(`Не найдено: «${text}»`), { status: 404 });
}
