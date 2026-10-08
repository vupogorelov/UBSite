// @ts-check
// Shows the reader's own translation variants in place of the original wording without changing
// the paragraph's text: the original fragment stays in the DOM inside a hidden span (so every
// plain-text offset used by notes, search and selection is still valid), and the variant is
// drawn by CSS from the data-text attribute (.tr-sub::before), outside the page's text.

/**
 * `original` (plain text) is shown in a hover tooltip (.tr-sub:hover::after).
 * `kind` styles the fragment: "mine" (the reader's own variant), "approved" (new edition),
 * "review" (the original stays visible, struck out, and the variant follows it).
 * @typedef {{ id: number, start: number, end: number, text: string, original?: string, kind?: 'mine' | 'approved' | 'review' }} Substitution
 */

const escapeAttr = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * @param {string} html paragraph HTML as produced by the importer (text, entities, <i>…</i>)
 * @param {Substitution[]} subs non-overlapping, any order; offsets in the plain text
 */
export function substituteHtml(html, subs) {
  const list = [...subs].sort((a, b) => a.start - b.start);
  if (!list.length) return html;
  let out = '';
  let pos = 0; // plain-text offset
  let italic = false;
  let si = 0;
  /** @type {Substitution | null} */
  let open = null;

  const openSub = (/** @type {Substitution} */ s) => {
    // Close an italic run around the wrapper so that tags never cross its boundary.
    if (italic) out += '</i>';
    const orig = s.original === undefined ? '' : ` data-orig="${escapeAttr(s.original)}"`;
    out += `<span class="tr-sub tr-${s.kind ?? 'mine'}" data-pid="${s.id}" data-text="${escapeAttr(s.text)}"${orig}><span class="tr-orig">`;
    if (italic) out += '<i>';
    open = s;
  };
  const closeSub = () => {
    if (italic) out += '</i>';
    out += '</span></span>';
    if (italic) out += '<i>';
    open = null;
    si++;
  };

  let i = 0;
  while (i < html.length) {
    if (!open && si < list.length && pos === list[si].start) openSub(list[si]);
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      const tag = html.slice(i, end + 1);
      if (tag === '<i>') italic = true;
      else if (tag === '</i>') italic = false;
      out += tag;
      i = end + 1;
      continue;
    }
    let len = 1;
    if (ch === '&') {
      const semi = html.indexOf(';', i);
      if (semi > i && semi - i <= 8) len = semi - i + 1;
    }
    out += html.slice(i, i + len);
    i += len;
    pos++;
    if (open && pos === /** @type {Substitution} */ (open).end) closeSub();
  }
  if (open) closeSub(); // a fragment reaching the very end of the paragraph
  return out;
}

/**
 * Puts the reader's own variants over the approved ones: an approved fragment overlapping any of
 * `top` is left out (substitutions cannot nest).
 * @template {{ start: number, end: number }} T
 * @param {T[]} top
 * @param {T[]} base
 * @returns {T[]}
 */
export function layer(top, base) {
  return [...top, ...base.filter((b) => top.every((t) => b.end <= t.start || t.end <= b.start))];
}

/**
 * Picks which of the reader's variants to show: the most recently changed wins where they overlap.
 * @template {{ start: number, end: number, updatedAt: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function pickNonOverlapping(items) {
  /** @type {T[]} */
  const chosen = [];
  for (const p of [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (chosen.every((c) => p.end <= c.start || c.end <= p.start)) chosen.push(p);
  }
  return chosen;
}
