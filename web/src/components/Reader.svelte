<script>
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from '../lib/api.js';
  import { route, view, replaceUrl, parsePath, linkClick, navigate } from '../lib/router.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { partLabel, paperLabel, sectionLabel, plural } from '../lib/format.js';
  import { search, stepHit, currentHit, clearSearch } from '../lib/search.svelte.js';
  import { notes, loadPaperNotes, hasThread } from '../lib/notes.svelte.js';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { setHighlights, clearHighlights, setRanges, anchorRange, textElement, textOffset } from '../lib/highlight.js';
  import Icon from './Icon.svelte';
  import MarginRail from './MarginRail.svelte';
  import NoteCard from './NoteCard.svelte';
  import SelectionToolbar from './SelectionToolbar.svelte';
  import ThreadDrawer from './ThreadDrawer.svelte';
  import TranslationPopover from './TranslationPopover.svelte';
  import { tr, thread, loadPublicPaper, openThread as openPublicThread } from '../lib/translation.svelte.js';
  import { substituteHtml, pickNonOverlapping, layer } from '../lib/substitute.js';
  import { session } from '../lib/session.svelte.js';
  import { tasks, loadTasks } from '../lib/tasks.svelte.js';
  import { trackScroll, showChrome, holdChrome, device } from '../lib/mobile.svelte.js';
  import { tts, registerReader, paperReady } from '../lib/tts.svelte.js';

  /** @typedef {import('../lib/router.svelte.js').Target} Target */
  /** @typedef {import('./SelectionToolbar.svelte').ToolbarState} ToolbarState */

  /** @type {import('../lib/api.js').PaperData | null} */
  let data = $state(null);
  let error = $state('');
  let loading = $state(false);
  /** @type {string | null} */
  let flashRef = $state(null);
  /** English paragraphs the reader expanded while in "collapsed" mode. */
  const expanded = new SvelteSet();
  /** While English is read aloud, the English text is shown in full so it can be followed. */
  const enMode = $derived(tts.open && tts.lang === 'en' ? 'full' : settings.enMode);
  /** @type {HTMLElement} */
  let scroller;
  /** @type {HTMLElement | undefined} */
  let article = $state();
  let token = 0;
  let scrollerWidth = $state(0);
  /** @type {ToolbarState | null} */
  let tb = $state(null);
  /** Recomputes the toolbar's anchor rectangle (after scrolling). @type {(() => DOMRect | null) | null} */
  let tbRect = null;

  const groups = $derived.by(() => {
    if (!data) return [];
    const byNum = Map.groupBy(data.paragraphs, (p) => p.sectionNum);
    return data.sections.map((s) => ({ ...s, paragraphs: byNum.get(s.num) ?? [] }));
  });

  // ---- Notes of this paper ----
  const paperNotes = $derived(data && notes.paperId === data.paper.id ? notes.items : []);
  const railItems = $derived(paperNotes.filter(hasThread));
  /** ref → markers for the gutter */
  // Open personal tasks per paragraph of this paper (a range marks each of its paragraphs).
  void loadTasks();
  const taskCounts = $derived.by(() => {
    /** @type {Map<string, number>} */
    const m = new Map();
    if (!data) return m;
    const index = new Map(data.paragraphs.map((p, i) => [p.ref, i]));
    for (const t of tasks.items) {
      if (t.status === 'done' || !t.ref) continue;
      const a = index.get(t.ref);
      if (a === undefined) continue;
      const b = t.refEnd ? index.get(t.refEnd) ?? a : a;
      for (let i = a; i <= b; i++) m.set(data.paragraphs[i].ref, (m.get(data.paragraphs[i].ref) ?? 0) + 1);
    }
    return m;
  });
  const markers = $derived.by(() => {
    /** @type {Map<string, { bookmark: boolean, comments: number, firstThread: number | null, tags: Set<string> }>} */
    const m = new Map();
    for (const n of paperNotes) {
      const e = m.get(n.ref) ?? { bookmark: false, comments: 0, firstThread: null, tags: new Set() };
      e.bookmark ||= n.bookmark;
      e.comments += n.comments.length;
      for (const t of n.tags) e.tags.add(t);
      if (n.comments.length && e.firstThread === null) e.firstThread = n.id;
      m.set(n.ref, e);
    }
    return m;
  });
  const railFits = $derived(scrollerWidth >= settings.columnWidth + 360);
  const showRail = $derived(settings.showRail && railFits && (railItems.length > 0 || notes.draft !== null));
  const activeNote = $derived(paperNotes.find((n) => n.id === notes.activeId) ?? null);
  const sheetOpen = $derived(!showRail && (notes.draft !== null || (activeNote !== null && activeNote.comments.length > 0)));

  // ---- Public layer: translation proposals and paragraph threads ----
  const paperProposals = $derived(data && tr.paperId === data.paper.id ? tr.proposals : []);
  /** Visible translation variants (not rejected/superseded). */
  const liveProposals = $derived(paperProposals.filter((p) => p.status === 'approved' || p.status === 'voting' || p.status === 'draft'));
  /** ref → number of live proposals */
  const proposalCounts = $derived(Map.groupBy(liveProposals, (p) => p.ref));
  /**
   * Variants shown in place of the text: the approved ones ("Новая редакция" / "Правка") and, over
   * them, the reader's drafts and own proposals under vote ("Мои варианты поверх текста"; the latest
   * wins where they overlap).
   * @type {{ p: import('../lib/api.js').Proposal, kind: 'mine' | 'approved' | 'review' }[]}
   */
  const subs = $derived.by(() => {
    const uid = session.user?.id;
    const mine = settings.trMine && uid
      ? liveProposals.filter((p) => p.authorId === uid && (p.status === 'draft' || p.status === 'voting'))
      : [];
    const approved = settings.trText !== 'original' ? liveProposals.filter((p) => p.status === 'approved') : [];
    const kind = settings.trText === 'review' ? 'review' : 'approved';
    const refs = new Set([...mine, ...approved].map((p) => p.ref));
    return [...refs].flatMap((ref) => {
      const top = pickNonOverlapping(mine.filter((p) => p.ref === ref)).map((p) => ({ p, kind: /** @type {const} */ ('mine'), start: p.start, end: p.end }));
      const base = approved.filter((p) => p.ref === ref).map((p) => ({ p, kind, start: p.start, end: p.end }));
      return layer(top, base);
    });
  });
  const subIds = $derived(new Set(subs.map((s) => s.p.id)));
  /** ref → paragraph HTML with the variants substituted (only for paragraphs that have any). */
  const substituted = $derived.by(() => {
    /** @type {Map<string, string>} */
    const out = new Map();
    if (!data) return out;
    for (const [ref, list] of Map.groupBy(subs, (s) => s.p.ref)) {
      const para = data.paragraphs.find((x) => x.ref === ref);
      if (para) {
        out.set(ref, substituteHtml(para.ru, list.map(({ p, kind }) => ({
          id: p.id, start: p.start, end: p.end, text: p.text, kind,
          original: kind === 'review' ? undefined : p.original, // in "Правка" the original is in plain view
        }))));
      }
    }
    return out;
  });
  /** Any translation display is on: Ctrl+click on a fragment opens its variants. */
  const trShown = $derived(settings.trMarks || settings.trMine || settings.trText !== 'original');
  /** @type {{ x: number, y: number, below: boolean, items: import('../lib/api.js').Proposal[], original: boolean, fragment: import('../lib/translation.svelte.js').Fragment } | null} */
  let pop = $state(null);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  /** Plain text of a paragraph's HTML (textContent equals the server's plain text). @param {string} html */
  function plainOf(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.textContent ?? '';
  }
  const threadTexts = $derived.by(() => {
    const p = thread.ref && data ? data.paragraphs.find((x) => x.ref === thread.ref) : null;
    return p ? { ru: plainOf(p.ru), en: plainOf(p.en) } : null;
  });

  // Underlines: approved (solid), under vote (dashed), own drafts (dotted).
  $effect(() => {
    // Variants shown in place of the text need no underline: their text already stands out.
    const items = liveProposals.filter((p) => !subIds.has(p.id)).map((p) => ({ ref: p.ref, start: p.start, end: p.end, status: p.status }));
    const on = settings.trMarks;
    void enMode, substituted; // re-rendered paragraphs invalidate earlier ranges
    tick().then(() => {
      /** @type {Record<string, Range[]>} */
      const ranges = { approved: [], voting: [], draft: [] };
      if (on && article) {
        for (const p of items) {
          const r = anchorRange(article, p.ref, 'ru', p.start, p.end);
          if (r) ranges[p.status].push(r);
        }
      }
      setRanges('tr-approved', ranges.approved, 0);
      setRanges('tr-voting', ranges.voting, 0);
      setRanges('tr-draft', ranges.draft, 0);
    });
  });

  $effect(() => {
    const target = { paper: route.paper, section: route.section, ref: route.ref };
    void route.nav;
    untrack(() => show(target));
  });

  $effect(() => {
    const id = data?.paper.id;
    if (id === undefined) return;
    untrack(() => {
      tb = null;
      notes.draft = null;
      loadPaperNotes(id).catch((err) => console.error('Notes not loaded:', err));
      loadPublicPaper(id).catch((err) => console.error('Translations not loaded:', err));
      pop = null;
    });
  });

  // Reading aloud takes its text from here and goes on to the next paper at the end of this one.
  $effect(() =>
    registerReader({
      article: () => article ?? null,
      scroller: () => scroller,
      paper: () => data?.paper.id ?? null,
      next: () => (data?.next != null ? (navigate(`/${data.next}`, { replace: true }), true) : false), // no history entry: "back" must not jump
    }),
  );
  $effect(() => {
    const id = data?.paper.id;
    if (id !== undefined) tick().then(() => untrack(paperReady));
  });

  $effect(() => {
    const ro = new ResizeObserver(() => (scrollerWidth = scroller.clientWidth));
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  // Search matches in the open paper; re-applied when the text re-renders (e.g. English mode).
  $effect(() => {
    const q = search.query;
    const paperId = data?.paper.id;
    void enMode, substituted; // re-rendered paragraphs invalidate earlier ranges
    if (!q || paperId === undefined) {
      clearHighlights('search');
      return;
    }
    let cancelled = false;
    api.highlights(q, paperId).then(
      async (map) => {
        await tick();
        if (!cancelled) setHighlights('search', scroller, map, 3);
      },
      (err) => console.error('Highlights not loaded:', err),
    );
    return () => (cancelled = true);
  });

  // Colored highlights, comment/bookmark underlines and the active note.
  $effect(() => {
    // Read every note field synchronously so that edits and additions re-run this effect.
    const items = paperNotes.map((n) => ({ ...n }));
    const active = notes.activeId;
    const draft = notes.draft;
    const visible = settings.showNotes;
    void enMode, substituted; // re-rendered paragraphs invalidate earlier ranges
    tick().then(() => {
      if (!article) return;
      /** @type {Record<string, Range[]>} */
      const byColor = Object.fromEntries(NOTE_COLORS.map(([c]) => [c, []]));
      const marks = [];
      const current = [];
      for (const n of items) {
        if (n.lang === null || n.start === null || n.end === null) continue;
        const r = anchorRange(article, n.ref, n.lang, n.start, n.end);
        if (!r) continue;
        if (n.id === active) current.push(r);
        if (!visible) continue;
        if (n.color) byColor[n.color].push(r);
        else marks.push(r);
      }
      if (draft?.lang && draft.start !== null && draft.end !== null) {
        const r = anchorRange(article, draft.ref, draft.lang, draft.start, draft.end);
        if (r) current.push(r);
      }
      for (const [c] of NOTE_COLORS) setRanges(`note-${c}`, byColor[c], 1);
      setRanges('note-mark', marks, 0);
      setRanges('note-active', current, 2);
    });
  });

  const hitIndex = $derived((void view.section, void route.nav, void search.refs, currentHit()));

  /** @param {Target} t */
  async function show(t) {
    const my = ++token;
    holdChrome();
    if (t.paper === null) {
      data = null;
      error = 'Страница не найдена';
      return;
    }
    if (data?.paper.id !== t.paper) {
      loading = true;
      try {
        const d = await api.paper(t.paper);
        if (my !== token) return;
        data = d;
        error = '';
        expanded.clear();
      } catch (err) {
        if (my === token) {
          data = null;
          error = /** @type {Error} */ (err).message;
        }
        return;
      } finally {
        if (my === token) loading = false;
      }
    }
    await tick();
    if (my === token) position(t);
  }

  /** @param {Target} t */
  function position(t) {
    const el = t.ref
      ? document.getElementById(`p-${t.ref}`)
      : t.section !== null
        ? document.getElementById(`s-${t.paper}:${t.section}`)
        : null;
    // A paragraph goes to the middle of a big screen; on a phone to the top (below the header),
    // so that its beginning is never above the screen.
    if (el) el.scrollIntoView({ block: t.ref && !device.mobile ? 'center' : 'start' });
    else scroller.scrollTop = 0;
    if (t.ref) {
      const ref = t.ref;
      flashRef = ref;
      setTimeout(() => flashRef === ref && (flashRef = null), 2000);
    }
    syncView();
  }

  /** Works out which section is at the top and mirrors it into the TOC and the address bar. */
  function syncView() {
    if (!data) return;
    const id = data.paper.id;
    const limit = scroller.getBoundingClientRect().top + 80;
    const heads = /** @type {NodeListOf<HTMLElement>} */ (scroller.querySelectorAll('[data-section]'));
    let current = 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    for (const h of heads) {
      if (atBottom || h.getBoundingClientRect().top <= limit) current = Number(h.dataset.section);
      else break;
    }
    const inUrl = parsePath(location.pathname);
    // A linked paragraph that is still on screen wins over the heading-based guess:
    // a paragraph centered near a section start sits below its own heading line.
    if (inUrl.ref && inUrl.paper === id) {
      const el = document.getElementById(`p-${inUrl.ref}`);
      const box = el?.getBoundingClientRect();
      const frame = scroller.getBoundingClientRect();
      if (box && box.bottom > frame.top && box.top < frame.bottom) current = inUrl.section ?? current;
    }
    view.paper = id;
    view.section = current;
    const keep = inUrl.paper === id && (inUrl.section ?? 0) === current;
    replaceUrl(keep ? location.pathname : current ? `/${id}:${current}` : `/${id}`);
  }

  let ticking = false;
  function onScroll() {
    if (scroller) trackScroll(scroller.scrollTop); // the phone's bars slide away while reading
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      syncView();
      if (tb && tbRect) {
        const r = tbRect();
        if (r) Object.assign(tb, place(r));
        else tb = null;
      }
    });
  }

  /** @param {MouseEvent} e @param {string} ref */
  async function copyRef(e, ref) {
    e.preventDefault();
    const url = `${location.origin}/${ref}`;
    replaceUrl(`/${ref}`);
    try {
      await navigator.clipboard.writeText(url);
      showToast(`Ссылка на ${ref} скопирована`);
    } catch {
      showToast(url);
    }
  }

  /** @param {string} ref */
  function toggleEn(ref) {
    if (!getSelection()?.isCollapsed) return; // the reader is selecting text, not toggling
    if (expanded.has(ref)) expanded.delete(ref);
    else expanded.add(ref);
  }

  // ---- Selection, clicks on notes, the toolbar ----

  /** Toolbar position above (or, near the top edge, below) a rectangle. @param {DOMRect} r */
  function place(r) {
    const below = r.top < 110;
    // x/y: where the floating toolbar goes (desktop); cx: the selection's real centre (the side of a docked panel).
    return { x: Math.min(Math.max(r.left + r.width / 2, 170), innerWidth - 170), y: below ? r.bottom + 8 : r.top - 8, below, cx: r.left + r.width / 2 };
  }

  /** @param {Node | null} node @returns {HTMLElement | null} */
  const textElOf = (node) => (node?.nodeType === Node.TEXT_NODE ? node.parentElement : /** @type {HTMLElement | null} */ (node))?.closest('[data-lang]') ?? null;

  function readSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const el = textElOf(range.startContainer);
    if (!el || el !== textElOf(range.endContainer) || !article?.contains(el)) return null;
    const text = el.textContent ?? '';
    let start = textOffset(el, range.startContainer, range.startOffset);
    let end = textOffset(el, range.endContainer, range.endOffset);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return null;
    return {
      ref: /** @type {string} */ (el.dataset.ref),
      lang: /** @type {'ru' | 'en'} */ (el.dataset.lang),
      start,
      end,
      quote: text.slice(start, end),
    };
  }

  /** @param {MouseEvent | KeyboardEvent} e */
  function onPointerUp(e) {
    if (/** @type {HTMLElement} */ (e.target).closest('.sel-toolbar, .rail, .note-sheet')) return;
    setTimeout(openForSelection);
  }

  /** Opens (or updates) the toolbar for the current text selection. */
  function openForSelection() {
    const a = readSelection();
    if (!a) return;
    const existing = paperNotes.find((n) => n.ref === a.ref && n.lang === a.lang && n.start === a.start && n.end === a.end);
    tbRect = () => {
      const sel = getSelection();
      return sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    };
    const r = tbRect();
    if (r) tb = { mode: existing ? 'edit' : 'new', ...place(r), anchor: a, noteId: existing?.id ?? null, text: a.quote };
  }

  // Touch screens select with a long press and drag the handles afterwards: follow the selection itself.
  $effect(() => {
    if (!device.touch) return;
    let timer = 0;
    const onChange = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (tb?.mode === 'para') return;
        if (getSelection()?.isCollapsed) return;
        openForSelection();
      }, 300);
    };
    document.addEventListener('selectionchange', onChange);
    return () => (clearTimeout(timer), document.removeEventListener('selectionchange', onChange));
  });

  // ---- The docked action panel (phone, tablet) must not cover the selected words ----
  const docked = $derived(device.mobile || device.touch);
  /**
   * While the side column would cover the selection, the selected paragraph (only it: reflowing the
   * whole column would move everything above) makes room on that side.
   * @type {{ ref: string, side: 'left' | 'right' } | null}
   */
  let dockPad = $state(null);
  $effect(() => {
    const t = tb;
    if (!t || !docked) {
      dockPad = null;
      return;
    }
    if (dockPad && dockPad.ref !== t.anchor.ref) dockPad = null;
    holdChrome(); // the panel sits next to the header / navigation: they stay while it is open
    tick().then(() => requestAnimationFrame(() => {
      const panel = document.querySelector('.sel-toolbar')?.getBoundingClientRect();
      // A whole paragraph: keep its beginning (number and first line) in view.
      const pr = t.mode === 'para' ? document.getElementById(`p-${t.anchor.ref}`)?.getBoundingClientRect() : null;
      const sel = pr ? new DOMRect(pr.left, pr.top, pr.width, Math.min(pr.height, 64)) : tbRect?.() ?? null;
      if (!panel || !sel || !scroller) return;
      const place = settings.textActions;
      if (place === 'side') {
        if (sel.right > panel.left && sel.left < panel.right) dockPad = { ref: t.anchor.ref, side: panel.left < innerWidth / 2 ? 'left' : 'right' };
        return;
      }
      // Top / bottom: scroll the text so that the selection is clear of the panel.
      const gap = 8;
      let dy = 0;
      if (place === 'top' && sel.top < panel.bottom + gap) dy = sel.top - (panel.bottom + gap);
      if (place === 'bottom' && sel.bottom > panel.top - gap) dy = sel.bottom - (panel.top - gap);
      if (dy) {
        holdChrome();
        scroller.scrollBy({ top: dy, behavior: 'smooth' });
      }
    }));
  });

  /** Text element and character offset under the pointer. @param {number} x @param {number} y */
  function caretAt(x, y) {
    /** @type {{ offsetNode: Node, offset: number } | null} */
    let pos = null;
    if (document.caretPositionFromPoint) pos = document.caretPositionFromPoint(x, y);
    else {
      const r = document.caretRangeFromPoint?.(x, y);
      if (r) pos = { offsetNode: r.startContainer, offset: r.startOffset };
    }
    const el = textElOf(pos?.offsetNode ?? null);
    if (!pos || !el) return null;
    return { el, ref: /** @type {string} */ (el.dataset.ref), lang: el.dataset.lang, off: textOffset(el, pos.offsetNode, pos.offset) };
  }

  /** The smallest note under the mouse pointer. @param {number} x @param {number} y */
  function noteAt(x, y) {
    const c = caretAt(x, y);
    if (!c) return null;
    const hits = paperNotes.filter(
      (n) => n.ref === c.ref && n.lang === c.lang && n.start !== null && n.end !== null && n.start <= c.off && c.off <= n.end,
    );
    return hits.sort((a, b) => /** @type {number} */ (a.end) - /** @type {number} */ (a.start) - (/** @type {number} */ (b.end) - /** @type {number} */ (b.start)))[0] ?? null;
  }

  /** Translation variants under the pointer, approved first. @param {number} x @param {number} y */
  function proposalsAt(x, y) {
    const c = caretAt(x, y);
    if (!c || c.lang !== 'ru') return [];
    const order = { approved: 0, voting: 1, draft: 2, rejected: 3, superseded: 4 };
    return liveProposals
      .filter((p) => p.ref === c.ref && p.start <= c.off && c.off <= p.end)
      .sort((a, b) => order[a.status] - order[b.status] || b.votes.for - a.votes.for);
  }

  /** @param {MouseEvent} e */
  function openPopover(e) {
    if (!article) return false;
    // A variant shown in place of the text: its original wording comes first in the popover.
    const sub = /** @type {HTMLElement} */ (e.target).closest('.tr-sub');
    const shown = sub ? liveProposals.find((p) => p.id === Number(/** @type {HTMLElement} */ (sub).dataset.pid)) : null;
    if (sub && shown) {
      const others = liveProposals.filter((p) => p.id !== shown.id && p.ref === shown.ref && p.start < shown.end && shown.start < p.end);
      tb = null;
      pop = {
        ...place(sub.getBoundingClientRect()), items: [shown, ...others], original: true,
        fragment: { ref: shown.ref, start: shown.start, end: shown.end, original: shown.original },
      };
      return true;
    }
    const items = proposalsAt(e.clientX, e.clientY);
    if (!items.length) return false;
    const top = items[0];
    const r = anchorRange(article, top.ref, 'ru', top.start, top.end)?.getBoundingClientRect();
    if (!r) return false;
    tb = null;
    pop = { ...place(r), items, original: false, fragment: { ref: top.ref, start: top.start, end: top.end, original: top.original } };
    return true;
  }

  /** "Перевести" from the toolbar: a Russian fragment, or the whole paragraph in paragraph mode. */
  function translateSelection() {
    if (!tb) return;
    const a = tb.anchor;
    if (tb.mode === 'para') {
      const text = article ? textElement(article, a.ref, 'ru')?.textContent ?? '' : '';
      openPublicThread(a.ref, { compose: { ref: a.ref, start: 0, end: text.length, original: text } });
    } else if (a.lang === 'ru' && a.start !== null && a.end !== null) {
      openPublicThread(a.ref, { compose: { ref: a.ref, start: a.start, end: a.end, original: a.quote ?? '' } });
    } else {
      showToast('Перевод предлагается к русскому тексту: выделите фрагмент русского абзаца');
      return;
    }
    tb = null;
    getSelection()?.removeAllRanges();
  }

  /** @param {import('../lib/api.js').Note} n */
  function openNoteToolbar(n) {
    if (!article || n.lang === null || n.start === null || n.end === null) return;
    const { ref, lang, start, end } = n;
    tbRect = () => (article ? anchorRange(article, ref, lang, start, end)?.getBoundingClientRect() ?? null : null);
    const r = tbRect();
    if (r) tb = { mode: 'edit', ...place(r), anchor: { ref, lang, start, end, quote: n.quote }, noteId: n.id, text: n.quote ?? '' };
  }

  /** @param {MouseEvent} e */
  function onArticleClick(e) {
    if (!getSelection()?.isCollapsed) return;
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest('a, button, input, textarea, .gutter')) return;
    showChrome();
    // Ctrl+click (or a tap on touch screens) on a translated fragment shows its variants.
    if (trShown && (e.ctrlKey || e.metaKey || touch) && openPopover(e)) return;
    pop = null;
    const n = settings.showNotes ? noteAt(e.clientX, e.clientY) : null;
    if (n) {
      notes.activeId = n.id;
      openNoteToolbar(n);
    } else {
      tb = null;
      if (!notes.draft) notes.activeId = null;
    }
  }

  /** Paragraph-level actions from the gutter. @param {MouseEvent} e @param {string} ref */
  function openParagraphMenu(e, ref) {
    const btn = /** @type {HTMLElement} */ (e.currentTarget);
    tbRect = () => btn.getBoundingClientRect();
    const existing = paperNotes.find((n) => n.ref === ref && n.lang === null);
    const text = article ? textElement(article, ref, 'ru')?.textContent ?? '' : '';
    tb = {
      mode: 'para', ...place(btn.getBoundingClientRect()),
      anchor: { ref, lang: null, start: null, end: null, quote: null }, noteId: existing?.id ?? null, text,
    };
  }

  /** @param {number | null} id */
  function openThread(id) {
    if (id === null) return;
    notes.activeId = id;
    tb = null;
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape' && (tb || pop)) {
      tb = null;
      pop = null;
      getSelection()?.removeAllRanges();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="reader">
  <div class="reader-scroll" bind:this={scroller} onscroll={onScroll}>
    {#if search.query}
      <div class="hitbar" role="toolbar" aria-label="Навигация по результатам поиска">
        <Icon name="search" />
        <span class="hitbar-q mono" title={search.query}>{search.query}</span>
        <span class="hitbar-pos">
          {hitIndex >= 0 ? `${hitIndex + 1} из ${search.total}` : `${search.total} ${plural(search.total, 'абзац', 'абзаца', 'абзацев')}`}
        </span>
        <button class="icon-btn small-btn" onclick={() => stepHit(-1)} disabled={!search.total}
          title="Предыдущее совпадение (Shift+F3)" aria-label="Предыдущее совпадение"><Icon name="up" /></button>
        <button class="icon-btn small-btn" onclick={() => stepHit(1)} disabled={!search.total}
          title="Следующее совпадение (F3)" aria-label="Следующее совпадение"><Icon name="down" /></button>
        <button class="icon-btn small-btn" onclick={clearSearch} title="Закрыть поиск" aria-label="Закрыть поиск"><Icon name="close" /></button>
      </div>
    {/if}
    {#if error}
      <div class="state">{error}</div>
    {:else if data}
      {@const paper = data.paper}
      <div class="paper-wrap">
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <article
          class="paper"
          class:loading
          class:no-gutter={!settings.showRefs && !settings.showPageRefs}
          class:tr-tint={settings.trTint}
          bind:this={article}
          onmouseup={onPointerUp}
          onkeyup={(e) => e.shiftKey && onPointerUp(e)}
          onclick={onArticleClick}
        >
          {#each groups as s (s.num)}
            {#if s.num === 0}
              <header class="paper-head" id="s-{paper.id}:0" data-section="0">
                <div class="kicker">Часть {partLabel(paper.partId)} · {paper.partTitleRu}</div>
                <h1>
                  {#if paper.id}<span class="paper-num">{paperLabel(paper.id)}</span>{/if}
                  <span data-tts="ru" data-tts-key="h0">{paper.titleRu}</span>
                </h1>
                {#if enMode !== 'hidden'}
                  <div class="en-title" lang="en">{paper.id ? `Paper ${paper.id} · ` : ''}<span data-tts="en" data-tts-key="h0">{paper.titleEn}</span></div>
                {/if}
              </header>
            {:else}
              <h2 class="section-head" id="s-{paper.id}:{s.num}" data-section={s.num}>
                <span><span class="sec-num">{sectionLabel(paper.id, s.num)}.</span> <span data-tts="ru" data-tts-key="h{s.num}">{s.titleRu}</span></span>
                {#if enMode !== 'hidden'}<span class="en-title" lang="en" data-tts="en" data-tts-key="h{s.num}">{s.titleEn}</span>{/if}
              </h2>
            {/if}

            {#each s.paragraphs as p (p.ref)}
              {@const mk = markers.get(p.ref)}
              {@const paraNote = paperNotes.find((n) => n.ref === p.ref && n.lang === null)}
              {@const proposalsN = proposalCounts.get(p.ref)?.length ?? 0}
              {@const messagesN = tr.messages[p.ref] ?? 0}
              {@const tasksN = taskCounts.get(p.ref) ?? 0}
              <div class="pair" class:flash={flashRef === p.ref} class:para-active={paraNote && paraNote.id === notes.activeId}
                class:dock-pad-left={dockPad?.ref === p.ref && dockPad.side === 'left'}
                class:dock-pad-right={dockPad?.ref === p.ref && dockPad.side === 'right'}
                class:para-draft={notes.draft?.ref === p.ref && notes.draft.lang === null} id="p-{p.ref}">
                <div class="gutter">
                  <div class="gutter-head">
                    <button class="para-menu" title="Закладка, комментарий, перевод или обсуждение всего абзаца"
                      aria-label="Действия с абзацем {p.ref}" onclick={(e) => openParagraphMenu(e, p.ref)}><Icon name="more" size={14} /></button>
                    {#if settings.showRefs}
                      <a class="ref" href="/{p.ref}" onclick={(e) => copyRef(e, p.ref)} title="Скопировать ссылку">{p.ref}</a>
                    {/if}
                  </div>
                  {#if settings.showPageRefs}
                    <span class="page" title="Страница.абзац печатного издания">{p.pageRef}</span>
                  {/if}
                  {#if (settings.showNotes && (mk?.bookmark || mk?.tags.size)) || mk?.comments || proposalsN || messagesN || tasksN}
                    <div class="gutter-marks">
                      {#if mk?.bookmark && settings.showNotes}
                        <span class="gmark gmark-bookmark" title="Есть закладка"><Icon name="bookmark" size={13} /><span class="n"></span></span>
                      {/if}
                      {#if mk?.comments}
                        <button class="gmark" title="Комментарии пространства: {mk.comments}" onclick={() => openThread(mk.firstThread)}>
                          <Icon name="comment" size={13} /><span class="n">{mk.comments}</span>
                        </button>
                      {/if}
                      {#if proposalsN}
                        <button class="gmark" title="Варианты перевода: {proposalsN}" onclick={() => openPublicThread(p.ref)}>
                          <Icon name="translate" size={13} /><span class="n">{proposalsN}</span>
                        </button>
                      {/if}
                      {#if messagesN}
                        <button class="gmark" title="Публичное обсуждение: {messagesN}" onclick={() => openPublicThread(p.ref)}>
                          <Icon name="discuss" size={13} /><span class="n">{messagesN}</span>
                        </button>
                      {/if}
                      {#if tasksN}
                        <button class="gmark" title="Мои задачи к абзацу: {tasksN}" onclick={() => navigate(`/tasks?ref=${p.ref}`)}>
                          <Icon name="check-square" size={13} /><span class="n">{tasksN}</span>
                        </button>
                      {/if}
                      {#if mk?.tags.size && settings.showNotes}
                        <span class="gmark gmark-tags" title={[...mk.tags].map((t) => '#' + t).join('  ')}>
                          <Icon name="tag" size={13} /><span class="n">{mk.tags.size}</span>
                        </span>
                      {/if}
                    </div>
                  {/if}
                </div>
                <div class="texts">
                  <p class="ru" data-ref={p.ref} data-lang="ru" data-tts="ru" data-tts-key={p.ref}>{@html substituted.get(p.ref) ?? p.ru}</p>
                  {#if enMode === 'full'}
                    <p class="en" lang="en" data-ref={p.ref} data-lang="en" data-tts="en" data-tts-key={p.ref}>{@html p.en}</p>
                  {:else if enMode === 'collapsed'}
                    {@const open = expanded.has(p.ref)}
                    <div class="en collapsible" class:expanded={open} lang="en" role="button" tabindex="0"
                      data-ref={p.ref} data-lang="en" data-tts="en" data-tts-key={p.ref}
                      aria-expanded={open} title={open ? 'Свернуть' : 'Развернуть'}
                      onclick={() => toggleEn(p.ref)}
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleEn(p.ref))}
                    >{@html p.en}</div>
                  {/if}
                </div>
              </div>
            {/each}
          {/each}

          <nav class="pager">
            {#if data.prev !== null}<a href="/{data.prev}" onclick={linkClick}>← {paperLabel(data.prev)}</a>{:else}<span></span>{/if}
            {#if data.next !== null}<a href="/{data.next}" onclick={linkClick}>{paperLabel(data.next)} →</a>{/if}
          </nav>
        </article>
        {#if showRail && article}
          <MarginRail {article} items={railItems} />
        {/if}
      </div>
    {:else if loading}
      <div class="state">Загрузка…</div>
    {/if}
  </div>

  {#if sheetOpen}
    <div class="note-sheet">
      {#if notes.draft}
        <NoteCard showQuote onclose={() => (notes.draft = null)} />
      {:else if activeNote}
        <NoteCard note={activeNote} showQuote onclose={() => (notes.activeId = null)} />
      {/if}
    </div>
  {/if}

  {#if tb}
    <SelectionToolbar {tb} onclose={() => (tb = null)} ontranslate={translateSelection}
      onthread={() => tb && (openPublicThread(tb.anchor.ref), (tb = null))} />
  {/if}
  {#if pop}
    <TranslationPopover {...pop} onclose={() => (pop = null)} />
  {/if}
</div>

{#if thread.ref}
  <ThreadDrawer ru={threadTexts?.ru ?? ''} en={threadTexts?.en ?? ''} />
{/if}
