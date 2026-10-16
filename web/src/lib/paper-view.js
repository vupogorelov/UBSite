// @ts-check
// What the reader shows over a paper's text, worked out from the data alone (no page, no state): the
// marks in each paragraph's margin, the variants of translation shown in place of the text, and the
// paragraphs' HTML with them (and the dictionary's names) put in. Reader.svelte derives its view from these.
import { substituteHtml, pickNonOverlapping, layer } from './substitute.js';
import { findAliases } from '../../../shared/aliases.js';

/** @typedef {import('./api.js').Proposal} Proposal */
/** @typedef {{ p: Proposal, kind: 'mine' | 'approved' | 'review', start: number, end: number }} Layer */

/**
 * Open personal tasks per paragraph (a range of paragraphs marks each of them).
 * @param {{ ref: string }[]} paragraphs the paper's, in order
 * @param {{ status: string, ref: string | null, refEnd: string | null }[]} tasks
 */
export function tasksPerParagraph(paragraphs, tasks) {
  /** @type {Map<string, number>} */
  const m = new Map();
  const index = new Map(paragraphs.map((p, i) => [p.ref, i]));
  for (const t of tasks) {
    if (t.status === 'done' || !t.ref) continue;
    const a = index.get(t.ref);
    if (a === undefined) continue;
    const b = t.refEnd ? index.get(t.refEnd) ?? a : a;
    for (let i = a; i <= b; i++) m.set(paragraphs[i].ref, (m.get(paragraphs[i].ref) ?? 0) + 1);
  }
  return m;
}

/**
 * A paragraph's marks in the margin from its notes: a bookmark, the comments (and the first note that
 * has them), the tags.
 * @param {{ id: number, ref: string, bookmark: boolean, comments: unknown[], tags: string[] }[]} notes
 */
export function marginMarks(notes) {
  /** @type {Map<string, { bookmark: boolean, comments: number, firstThread: number | null, tags: Set<string> }>} */
  const m = new Map();
  for (const n of notes) {
    const e = m.get(n.ref) ?? { bookmark: false, comments: 0, firstThread: null, tags: new Set() };
    e.bookmark ||= n.bookmark;
    e.comments += n.comments.length;
    for (const t of n.tags) e.tags.add(t);
    if (n.comments.length && e.firstThread === null) e.firstThread = n.id;
    m.set(n.ref, e);
  }
  return m;
}

/**
 * The variants shown in place of the text: the approved ones ("Новая редакция" / "Правка") and, over them,
 * the reader's drafts and own proposals under vote ("Мои варианты поверх текста"; the latest wins where
 * they overlap).
 * @param {Proposal[]} live the paper's live variants (approved, voting, drafts)
 * @param {{ uid: number | undefined, mine: boolean, text: 'original' | 'approved' | 'review' | string }} o
 * @returns {Layer[]}
 */
export function variantLayers(live, o) {
  const mine = o.mine && o.uid ? live.filter((p) => p.authorId === o.uid && (p.status === 'draft' || p.status === 'voting')) : [];
  const approved = o.text !== 'original' ? live.filter((p) => p.status === 'approved') : [];
  const kind = /** @type {'review' | 'approved'} */ (o.text === 'review' ? 'review' : 'approved');
  const refs = new Set([...mine, ...approved].map((p) => p.ref));
  return [...refs].flatMap((ref) => {
    const top = pickNonOverlapping(mine.filter((p) => p.ref === ref)).map((p) => ({ p, kind: /** @type {Layer['kind']} */ ('mine'), start: p.start, end: p.end }));
    const base = approved.filter((p) => p.ref === ref).map((p) => ({ p, kind: /** @type {Layer['kind']} */ (kind), start: p.start, end: p.end }));
    return layer(top, base);
  });
}

/**
 * ref → the paragraph's Russian HTML with the variants and the dictionary's names ("Названия по смыслу")
 * put in — only for the paragraphs that have any. A name is not put where a variant stands.
 * @param {{ ref: string, ru: string }[]} paragraphs
 * @param {Layer[]} layers
 * @param {import('../../../shared/aliases.js').Alias[]} names the dictionary (empty — off)
 * @param {(html: string) => string} plainOf a paragraph's plain text
 */
export function substitutedParagraphs(paragraphs, layers, names, plainOf) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const byRef = Map.groupBy(layers, (s) => s.p.ref);
  const refs = new Set(byRef.keys());
  if (names.length) for (const p of paragraphs) if (names.some((a) => p.ru.includes(a.written))) refs.add(p.ref);
  for (const ref of refs) {
    const para = paragraphs.find((x) => x.ref === ref);
    if (!para) continue;
    const variants = (byRef.get(ref) ?? []).map(({ p, kind }) => ({
      id: p.id, start: p.start, end: p.end, text: p.text, kind,
      original: kind === 'review' ? undefined : p.original, // in "Правка" the original is in plain view
    }));
    /** @type {import('./substitute.js').Substitution[]} */
    const named = names.length
      ? findAliases(plainOf(para.ru), names)
        .filter((n) => !variants.some((v) => n.start < v.end && v.start < n.end))
        .map((n) => ({ id: 0, start: n.start, end: n.end, text: n.text, original: n.original, kind: 'alias' }))
      : [];
    out.set(ref, substituteHtml(para.ru, [...variants, ...named]));
  }
  return out;
}
