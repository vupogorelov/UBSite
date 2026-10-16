// @ts-check
// Pairs of terms (a computer): the mouse over a glossary term lights it and its counterpart in the other
// language (orange), its other places in the paragraph (blue); a counterpart not in view — in a tip.
// The paper's terms come from the server (api.paperTerms: per paragraph and language, triples of
// start, end, term id); the reader gives the article they are in.
import { setRanges, clearHighlights, anchorRange, textElement, caretAt } from './highlight.js';

/** @typedef {{ terms: [number, string, string][], paras: Record<string, { ru: number[], en: number[] }> }} PaperTerms */

/** @param {() => HTMLElement | null | undefined} root the paper's article */
export function createTermPairs(root) {
  const view = $state(/** @type {{ tip: { x: number, y: number, text: string, lang: string } | null }} */ ({ tip: null }));
  /** @type {{ names: Map<number, [string, string]>, paras: PaperTerms['paras'] } | null} */
  let terms = null;
  /** The place under the mouse ("ref:lang:start"), so a move within it changes nothing. @type {string | null} */
  let at = null;
  /** Shown words of a variant or a dictionary name (.tr-sub): their text is drawn by CSS, so the element is marked. @type {HTMLElement[]} */
  let subs = [];
  let frame = 0;

  function clear() {
    cancelAnimationFrame(frame);
    at = null;
    view.tip = null;
    clearHighlights('term-cur');
    clearHighlights('term-other');
    for (const el of subs) el.classList.remove('term-cur', 'term-other');
    subs = [];
  }

  /** @param {number} x @param {number} y */
  function show(x, y) {
    const article = root();
    if (!terms || !article) return;
    const c = caretAt(x, y);
    const lang = c?.lang === 'en' ? 'en' : 'ru';
    const list = c?.ref ? terms.paras[c.ref]?.[lang] : undefined;
    let hit = -1;
    if (c && list) for (let i = 0; i < list.length; i += 3) if (list[i] <= c.off && c.off < list[i + 1]) hit = i;
    if (!c || !list || hit < 0) return void (at && clear());
    const key = `${c.ref}:${lang}:${list[hit]}`;
    if (key === at) return;
    clear();
    at = key;
    const id = list[hit + 2];
    const other = lang === 'ru' ? 'en' : 'ru';
    const theirs = terms.paras[c.ref]?.[other] ?? [];
    const places = (/** @type {number[]} */ l) => l.flatMap((_, i) => (i % 3 === 0 && l[i + 2] === id ? [i] : []));
    const mine = places(list), their = places(theirs);
    // the counterpart: the same place in order, when both languages name the term as many times
    const pair = their.length === mine.length ? their[mine.indexOf(hit)] : undefined;
    const range = (/** @type {'ru' | 'en'} */ l, /** @type {number[]} */ arr, /** @type {number} */ i) => anchorRange(article, c.ref, l, arr[i], arr[i + 1]);
    const cur = [range(lang, list, hit), pair === undefined ? null : range(other, theirs, pair)];
    const others = [...mine.filter((i) => i !== hit).map((i) => range(lang, list, i)), ...their.filter((i) => i !== pair).map((i) => range(other, theirs, i))];
    /** @param {(Range | null)[]} rs @param {string} cls */
    const mark = (rs, cls) => {
      for (const r of rs) {
        const sub = r && /** @type {HTMLElement | null} */ (r.startContainer.parentElement?.closest('.tr-sub'));
        if (sub) (sub.classList.add(cls), subs.push(sub));
      }
      return /** @type {Range[]} */ (rs.filter(Boolean));
    };
    setRanges('term-cur', mark(cur, 'term-cur'), 3);
    setRanges('term-other', mark(others, 'term-other'), 3);
    // the counterpart out of view (no English under the text, or folded to a line): its name in a tip
    const pr = cur[1], el = textElement(article, c.ref, other);
    const pRect = pr?.getBoundingClientRect(), eRect = el?.getBoundingClientRect();
    const seen = !!(pRect && eRect && pRect.width && pRect.top >= eRect.top - 1 && pRect.bottom <= eRect.bottom + 1);
    const name = terms.names.get(id);
    const r = cur[0]?.getBoundingClientRect();
    view.tip = !seen && name && r ? { x: r.left + r.width / 2, y: r.top, text: name[other === 'en' ? 0 : 1], lang: other } : null;
  }

  return {
    /** The tip with a counterpart's name (null — none). */
    get tip() {
      return view.tip;
    },
    /** The paper's terms (null — none: another paper, the setting off). @param {PaperTerms | null} t */
    set(t) {
      clear();
      terms = t ? { names: new Map(t.terms.map(([i, en, ru]) => [i, [en, ru]])), paras: t.paras } : null;
    },
    /** @param {MouseEvent} e */
    move(e) {
      if (!terms || e.buttons) return;
      const { clientX: x, clientY: y } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => show(x, y));
    },
    clear,
  };
}
