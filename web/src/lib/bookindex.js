// @ts-check
// The book as a line of paragraphs (from the contents): how many come before each paper and in all, so
// a place in the book is a share of it and a share is a place. Arithmetic only (lib/bookmap.svelte.js
// loads the contents and keeps the index).

/**
 * Paragraphs before each paper and in the whole book; `papers` in book order.
 * @typedef {{ before: Map<number, number>, total: number, papers: { id: number, count: number }[] }} BookIndex
 */

/** @param {{ papers: { id: number, paragraphs?: number }[] }} toc @returns {BookIndex} */
export function indexOf(toc) {
  const before = new Map();
  let total = 0;
  for (const p of toc.papers) {
    before.set(p.id, total);
    total += p.paragraphs ?? 0;
  }
  return { before, total, papers: toc.papers.map((p) => ({ id: p.id, count: p.paragraphs ?? 0 })) };
}

/**
 * The share of the book before paragraph `idx` (fractional: a part of a paragraph counts) of `paper`.
 * @param {BookIndex | null} index @param {number} paper @param {number} idx @returns {number | null} null — no index
 */
export function shareIn(index, paper, idx) {
  if (!index || !index.total) return null;
  return Math.min(1, Math.max(0, ((index.before.get(paper) ?? 0) + idx) / index.total));
}

/** The paper and its paragraph at a share of the book. @param {BookIndex | null} index @param {number} frac */
export function placeIn(index, frac) {
  if (!index || !index.total) return null;
  const g = Math.min(index.total - 1, Math.max(0, Math.floor(frac * index.total)));
  for (const p of index.papers) {
    const before = index.before.get(p.id) ?? 0;
    if (g < before + p.count) return { paper: p.id, idx: g - before };
  }
  return null;
}
