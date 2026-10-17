// @ts-check
// Hints of the dictionary while reading (the setting «Подсказки словаря»): the first place each article is
// named in a section is marked (a dot over the word or a thin line under it — HintLayer.svelte); the mouse
// over it shows the article's card, a tap opens it as a sheet (WhatIsCard.svelte). The places come from the
// paper's terms (the same as the pairs of terms) and the published articles' glossary entries (marks.js).
import { dictApi } from './api.js';
import { firstMentions } from './marks.js';
import { showWhatIs } from './whatis.svelte.js';
import { anchorRange, caretAt } from '../../lib/highlight.js';

/** @typedef {import('./api.js').ArticleItem} ArticleItem */
/** @typedef {import('./marks.js').Mark} Mark */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/** The published articles, asked again when older than five minutes. @type {{ list: ArticleItem[] | null, at: number, asking: Promise<ArticleItem[]> | null }} */
const known = { list: null, at: 0, asking: null };
function articles() {
  if (known.list && Date.now() - known.at < 5 * 60_000) return Promise.resolve(known.list);
  known.asking ??= dictApi.list().then(
    (l) => ((known.list = l), (known.at = Date.now()), (known.asking = null), l),
    (err) => ((known.asking = null), known.list ?? Promise.reject(err)),
  );
  return known.asking;
}

/**
 * @param {() => HTMLElement | null | undefined} root the paper's article
 * @param {() => HTMLElement | null | undefined} layer where the marks are drawn (inside the article)
 */
export function createDictHints(root, layer) {
  const view = $state(/** @type {{ spots: { id: number, boxes: Box[] }[], card: { item: ArticleItem, x: number, y: number } | null }} */ ({ spots: [], card: null }));
  /** @type {(Mark & { item: ArticleItem })[]} */
  let marks = [];
  let lang = /** @type {'ru' | 'en'} */ ('ru');
  let frame = 0;
  let asked = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let showTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let hideTimer;
  /** The mark the mouse is over. @type {Mark | null} */
  let over = null;

  /** Where the marked words stand, in the layer's coordinates (again after the text moved). */
  function place() {
    const article = root(), box = layer()?.getBoundingClientRect();
    if (!article || !box) return void (view.spots = []);
    view.spots = marks.map((m, i) => {
      const rects = [...(anchorRange(article, m.ref, lang, m.start, m.end)?.getClientRects() ?? [])].filter((r) => r.width);
      return { id: i, boxes: rects.map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height })) };
    }).filter((s) => s.boxes.length);
  }
  const replace = () => (cancelAnimationFrame(frame), (frame = requestAnimationFrame(place)));

  /** The mark under a point of the screen. @param {number} x @param {number} y */
  function markAt(x, y) {
    const c = caretAt(x, y);
    if (!c || c.lang !== lang) return null;
    return marks.find((m) => m.ref === c.ref && m.start <= c.off && c.off < m.end) ?? null;
  }

  /** @param {Mark & { item: ArticleItem }} m */
  function showCard(m) {
    clearTimeout(hideTimer);
    const article = root();
    const r = article && anchorRange(article, m.ref, lang, m.start, m.end)?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(340, innerWidth - 16);
    view.card = { item: m.item, x: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, innerWidth - width - 8)), y: r.bottom + 8 };
  }
  function hideSoon() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (view.card = null), 300);
  }

  return {
    /** The marked words' boxes (for HintLayer). */
    get spots() {
      return view.spots;
    },
    /** The card over the text (a computer): the article, where. */
    get card() {
      return view.card;
    },
    /**
     * The paper's terms (null — none: another paper, the setting off) and the reading language.
     * @param {import('../../lib/termpairs.svelte.js').PaperTerms | null} terms @param {'ru' | 'en'} readLang
     */
    async set(terms, readLang) {
      const mine = ++asked;
      this.clear();
      marks = [];
      view.spots = [];
      if (!terms) return;
      const list = await articles().catch(() => []);
      if (mine !== asked) return;
      const byId = new Map(list.map((a) => [a.id, a]));
      const articleOf = new Map(list.flatMap((a) => (a.names ?? []).map((g) => /** @type {[number, number]} */ ([g, a.id]))));
      lang = readLang;
      marks = firstMentions(terms.paras, articleOf, lang).map((m) => ({ ...m, item: /** @type {ArticleItem} */ (byId.get(m.article)) }));
      replace();
    },
    /** The text moved (its width, the font, the English opened). */
    place: replace,
    /** The mouse over the text: over a marked word a while — its card. @param {MouseEvent} e */
    move(e) {
      if (!marks.length || e.buttons) return;
      const m = markAt(e.clientX, e.clientY);
      if (m === over) return;
      over = m;
      clearTimeout(showTimer);
      if (m) showTimer = setTimeout(() => showCard(/** @type {Mark & { item: ArticleItem }} */ (m)), view.card ? 0 : 350);
      else if (view.card) hideSoon();
    },
    /** A click or a tap on a marked word: its card (a sheet on a phone). @param {MouseEvent} e @param {boolean} touch @returns {boolean} taken */
    tap(e, touch) {
      const m = marks.length ? markAt(e.clientX, e.clientY) : null;
      if (!m) return false;
      const i = /** @type {Mark & { item: ArticleItem }} */ (m).item;
      if (touch) showWhatIs({ id: i.id, kind: i.kind, nameRu: i.nameRu, nameEn: i.nameEn, briefRu: i.briefRu, briefEn: i.briefEn });
      else showCard(/** @type {Mark & { item: ArticleItem }} */ (m));
      return true;
    },
    /** The mouse over the card keeps it; leaving it — gone a moment later. */
    keep: () => clearTimeout(hideTimer),
    leave: hideSoon,
    clear() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      over = null;
      view.card = null;
    },
  };
}
