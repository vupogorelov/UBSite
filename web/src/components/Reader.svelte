<script>
  /**
   * `background`: another page (chat, tasks…) covers the book while it is read aloud — the reader stays,
   * hidden, so the voice goes on (and on to the next paper); it does not follow the address then.
   * @type {{ background?: boolean }}
   */
  let { background = false } = $props();
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from '../lib/api.js';
  import { route, view, replaceUrl, parsePath, linkClick, navigate, rememberBookPath } from '../lib/router.svelte.js';
  import { settings, setSetting } from '../lib/settings.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { partName, paperLabel, sectionLabel, plural } from '../lib/format.js';
  import { search, stepHit, currentHit, clearSearch } from '../lib/search.svelte.js';
  import { notes, loadPaperNotes, hasThread, createNote, patchNote, deleteNote } from '../lib/notes.svelte.js';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { setHighlights, clearHighlights, setRanges, anchorRange, textElement, textOffset, textElOf, caretAt } from '../lib/highlight.js';
  import { createTermPairs } from '../lib/termpairs.svelte.js';
  import { createDictHints } from '../features/dictionary/hints.svelte.js';
  import HintLayer from '../features/dictionary/HintLayer.svelte';
  import Icon from './Icon.svelte';
  import MarginRail from './MarginRail.svelte';
  import NoteCard from './NoteCard.svelte';
  import SelectionToolbar from './SelectionToolbar.svelte';
  import ThreadDrawer from './ThreadDrawer.svelte';
  import TranslationPopover from './TranslationPopover.svelte';
  import ReadProgress from './ReadProgress.svelte';
  import BookNotesPanel from './BookNotesPanel.svelte';
  import BookSearchPanel from './BookSearchPanel.svelte';
  import { portal, phonePortal } from '../lib/portal.js';
  import { swipeOpen } from '../lib/swipe.js';
  import { edgePull } from '../lib/edgepull.js';
  import { quoteOf, placeLink, shareLink } from '../lib/share.js';
  import { askLogin } from '../lib/guest.svelte.js';
  import { aliases, loadAliases } from '../lib/aliases.svelte.js';
  import { pinchFont } from '../lib/pinch.js';
  import { ui } from '../lib/ui.svelte.js';
  import { tr, thread, loadPublicPaper, openThread as openPublicThread } from '../lib/translation.svelte.js';
  import { discussInChat } from '../lib/chat.svelte.js';
  import { tasksPerParagraph, marginMarks, variantLayers, substitutedParagraphs } from '../lib/paper-view.js';
  import { session } from '../lib/session.svelte.js';
  import { tasks, loadTasks } from '../lib/tasks.svelte.js';
  import { trackScroll, showChrome, holdChrome, device } from '../lib/mobile.svelte.js';
  import { tts, registerReader, paperReady, setLang, playParagraph, paragraphPlaying, loadRecordings } from '../lib/tts.svelte.js';
  import { loadBook, bookShare } from '../lib/bookmap.svelte.js';
  import { noteRead } from '../lib/places.svelte.js';
  import { firstParagraph } from '../lib/onscreen.js';
  import { book, titleIn } from '../lib/lang.svelte.js';

  /** The language the book is read in ("Язык чтения") and the comparison under it, if any (lib/lang.svelte.js). */
  const main = $derived(book.main);
  /** Not signed in: came by a shared link (lib/guest.svelte.js) — reads; the rest asks to sign in. */
  const isGuest = $derived(!session.user);
  loadBook(); // the paragraph map: the reading place carries its share of the book
  if (session.user) loadRecordings(); // (a paragraph's ▶ plays the recording where the language is set to it)

  /** @typedef {import('../lib/router.svelte.js').Target} Target */
  /** @typedef {import('../lib/notes.svelte.js').ToolbarState} ToolbarState */

  let data = $state(/** @type {import('../lib/api.js').PaperData | null} */ (null));
  let error = $state('');
  let loading = $state(false);
  let flashRef = $state(/** @type {string | null} */ (null));
  /** English paragraphs the reader expanded while in "collapsed" mode. */
  const expanded = new SvelteSet();
  /** The comparison (the English under the Russian): while English is read aloud it is shown in full, to be followed; reading in English there is none. */
  const enMode = $derived(main !== 'ru' ? 'hidden' : tts.open && tts.lang === 'en' ? 'full' : settings.enMode);
  // Reading in English, the voice reads English (the Russian is not on the page)
  $effect(() => {
    if (main === 'en' && tts.lang !== 'en') setLang('en');
  });
  /** @type {HTMLElement} */
  let scroller = $state(/** @type {any} */ (undefined));
  /** @type {HTMLElement | undefined} */
  let article = $state();
  let token = 0;
  let scrollerWidth = $state(0);
  let tb = $state(/** @type {ToolbarState | null} */ (null));
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
  // The margin of each paragraph (lib/paper-view.js): its open personal tasks, its notes' marks.
  if (session.user) void loadTasks();
  const taskCounts = $derived(data ? tasksPerParagraph(data.paragraphs, tasks.items) : new Map());
  const markers = $derived(marginMarks(paperNotes));
  const railFits = $derived(scrollerWidth >= settings.columnWidth + 360);
  const showRail = $derived(settings.showRail && railFits && (railItems.length > 0 || notes.draft !== null));
  const activeNote = $derived(paperNotes.find((n) => n.id === notes.activeId) ?? null);
  /**
   * One tap — one window: a note with comments opens its sheet alone; "⋯" there gives the panel of text
   * actions the sheet's place (`noteActions`) until the panel closes, then the sheet comes back.
   */
  let noteActions = $state(false);
  const sheetOpen = $derived(!showRail && !noteActions && (notes.draft !== null || (activeNote !== null && activeNote.comments.length > 0)));
  /** @param {import('../lib/api.js').Note} n */
  function noteActionsFor(n) {
    noteActions = true;
    openNoteToolbar(n);
    if (!tb) noteActions = false; // its words are not on screen
  }
  $effect(() => {
    if (!tb && noteActions) noteActions = false;
  });

  /**
   * Swipes over the text (touch screens, reading or listening, while no side panel is open): to the left —
   * the book's notes from the right, to the right — search from the left.
   */
  let bookNotes = $state(false);
  let bookSearch = $state(false);
  const touchScreen = matchMedia('(pointer: coarse)').matches;
  const canSwipe = () => touchScreen && !isGuest && !bookNotes && !bookSearch && !ui.sidebarOpen && !tb && !pop && !sheetOpen && !thread.ref;

  // ---- Public layer: translation proposals and paragraph threads ----
  const paperProposals = $derived(data && tr.paperId === data.paper.id ? tr.proposals : []);
  /** Visible translation variants (not rejected/superseded). */
  const liveProposals = $derived(paperProposals.filter((p) => p.status === 'approved' || p.status === 'voting' || p.status === 'draft'));
  /** ref → number of live proposals */
  const proposalCounts = $derived(Map.groupBy(liveProposals, (p) => p.ref));
  /** Variants shown in place of the text (lib/paper-view.js). */
  const subs = $derived(variantLayers(liveProposals, { uid: session.user?.id, mine: settings.trMine, text: settings.trText }));
  const subIds = $derived(new Set(subs.map((s) => s.p.id)));
  /** ref → paragraph HTML with the variants and the dictionary's names put in (only the paragraphs that have any). */
  const substituted = $derived(data ? substitutedParagraphs(data.paragraphs, subs, settings.altNames ? aliases.list : [], plainOf) : new Map());
  $effect(() => {
    if (settings.altNames && session.user) void loadAliases();
  });
  /** Any translation display is on: Ctrl+click on a fragment opens its variants. */
  const trShown = $derived(main === 'ru' && (settings.trMarks || settings.trMine || settings.trText !== 'original')); // the layer is about the Russian
  let pop = $state(/** @type {{ x: number, y: number, below: boolean, items: import('../lib/api.js').Proposal[], original: boolean, fragment: import('../lib/translation.svelte.js').Fragment } | null} */ (null));
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
    const on = settings.trMarks && main === 'ru';
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

  // Another page over the book: the reader stays (Shell.svelte), its paper and place with it — back to the
  // place it left (its own address), the book is on screen at once, where it was, nothing asked for
  /** Where the text was scrolled to, and the address it wrote for it (syncView). */
  let keptTop = 0;
  let ownPath = '';
  let returning = false;
  $effect(() => {
    const target = { paper: route.paper, section: route.section, ref: route.ref };
    void route.nav;
    if (background) {
      returning = true;
      return; // (another page is open: the book stays where the voice is)
    }
    untrack(() => {
      const back = returning && !!data && data.paper.id === target.paper && location.pathname + location.search === ownPath;
      returning = false;
      if (!back) return void show(target);
      if (scroller.scrollTop !== keptTop) scroller.scrollTop = keptTop;
      syncView();
    });
  });

  $effect(() => {
    const id = data?.paper.id;
    if (id === undefined) return;
    untrack(() => {
      tb = null;
      notes.draft = null;
      if (session.user) loadPaperNotes(id).catch((err) => console.error('Notes not loaded:', err));
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
      next: () => {
        if (data?.next == null) return false;
        const n = data.next;
        if (background) {
          // another page is open: the next paper is opened here, unseen; the way back to the book leads to it
          void show({ paper: n, section: null, ref: null });
          rememberBookPath(`/${n}`);
        } else navigate(`/${n}`, { replace: true }); // no history entry: "back" must not jump
        return true;
      },
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
    // (by meaning: nothing to mark — the words are not what was found)
    const q = search.mode === 'meaning' ? '' : search.query;
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

  /**
   * The papers next to the open one, fetched while it is read: turning to the next (or back) is instant
   * even where the book is not on the device yet (a guest by a link, the copy still being saved).
   * @type {Map<number, Promise<import('../lib/api.js').PaperData | null>>}
   */
  const ahead = new Map();
  $effect(() => {
    const near = data ? [data.next, data.prev] : [];
    const timer = setTimeout(() => {
      for (const id of near) {
        if (id === null || ahead.has(id)) continue;
        ahead.set(id, api.paper(id).catch(() => (ahead.delete(id), null)));
      }
      // only the neighbours of the last papers are kept
      for (const id of [...ahead.keys()].slice(0, -4)) ahead.delete(id);
    }, 1200); // (after the open paper has settled)
    return () => clearTimeout(timer);
  });

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
        const d = (await ahead.get(t.paper)) ?? (await api.paper(t.paper));
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
    else if (landAtEnd === t.paper) scroller.scrollTop = scroller.scrollHeight; // pulled back from the next paper
    else scroller.scrollTop = 0;
    landAtEnd = null;
    if (t.ref) {
      const ref = t.ref;
      flashRef = ref;
      setTimeout(() => flashRef === ref && (flashRef = null), 2000);
    }
    showQuote(t);
    syncView();
  }

  /** A shared link's quote ("?sel=", lib/share.js): lit in its paragraph (the English unfolded for it). @param {Target} t */
  async function showQuote(t) {
    const q = t.ref ? quoteOf(location.search) : null;
    if (!q || !t.ref || !article) return clearHighlights('shared-quote');
    if (q.lang === 'en' && enMode === 'collapsed') {
      expanded.add(t.ref);
      await tick();
    }
    const r = article && anchorRange(article, t.ref, q.lang, q.start, q.end);
    if (r) setRanges('shared-quote', [r], 2);
    else clearHighlights('shared-quote');
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
    // Where the reader is: kept for this user's other devices (lib/places).
    const first = article && firstParagraph(article, scroller, device.mobile ? 64 : 8);
    if (first && session.user) noteRead({ paper: id, key: first.ref, lang: main, progress: bookShare(id, first.inside) });
    const keep = inUrl.paper === id && (inUrl.section ?? 0) === current;
    // (a shared quote's "?sel=" stays while its paragraph's address does: signing in keeps the place)
    ownPath = keep ? location.pathname + location.search : current ? `/${id}:${current}` : `/${id}`;
    replaceUrl(ownPath);
  }

  // ---- Pulling on past the paper's end (or beginning): the next paper from its start, the previous at its end ----
  /** The paper to open at its end (pulled back into it). @type {number | null} */
  let landAtEnd = null;
  let pull = $state(/** @type {{ dir: import('../lib/edgepull.js').PullDir, p: number } | null} */ (null));
  /** @type {import('../lib/edgepull.js').PullOptions} */
  const pullOpts = {
    can: (dir) => !background && !!data && (dir === 'next' ? data.next !== null : data.prev !== null)
      && !tb && !sheetOpen && !bookNotes && !bookSearch,
    onprogress: (dir, p) => (pull = dir ? { dir, p } : null),
    ongo: (dir) => {
      const id = dir === 'next' ? data?.next : data?.prev;
      if (id == null) return;
      if (dir === 'prev') landAtEnd = id;
      navigate(`/${id}`);
    },
  };

  let ticking = false;
  function onScroll() {
    if (background) return; // (hidden: its place is kept as it was)
    keptTop = scroller.scrollTop;
    trackScroll(scroller.scrollTop); // the phone's bars slide away while reading
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
    replaceUrl(`/${ref}`);
    await shareLink(placeLink(ref), undefined, `Ссылка на ${ref} скопирована`);
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
  // Top / bottom: the text scrolls clear of the panel. Side: the column lies over the text at the edge
  // away from the selection — the text itself never moves or reflows.
  const docked = $derived(device.mobile || device.touch);
  $effect(() => {
    const t = tb;
    if (!t || !docked) return;
    holdChrome(); // the panel sits next to the header / navigation: they stay while it is open
    tick().then(() => requestAnimationFrame(() => {
      const panel = document.querySelector('.sel-toolbar')?.getBoundingClientRect();
      // A whole paragraph: keep its beginning (number and first line) in view.
      const pr = t.mode === 'para' ? document.getElementById(`p-${t.anchor.ref}`)?.getBoundingClientRect() : null;
      const sel = pr ? new DOMRect(pr.left, pr.top, pr.width, Math.min(pr.height, 64)) : tbRect?.() ?? null;
      if (!panel || !sel || !scroller) return;
      const place = settings.textActions;
      // Side: the column lies over the text at the edge away from the selection; the text never moves.
      if (place === 'side') return;
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

  // ---- Pairs of terms (a computer): a glossary term under the mouse lit with its counterpart (lib/termpairs.svelte.js) ----
  // ---- and the dictionary's hints: its articles' words marked, their cards (features/dictionary/hints.svelte.js) ----
  const termPairs = createTermPairs(() => article);
  /** @type {HTMLElement | null} */
  let hintLayer = $state(null);
  const dictHints = createDictHints(() => article, () => hintLayer);
  $effect(() => {
    const id = data?.paper.id;
    const pairs = settings.termPairs && !device.touch, hints = settings.dictHints, lang = main;
    termPairs.set(null);
    void dictHints.set(null, lang);
    if (id === undefined || !(pairs || hints) || !session.user) return;
    let live = true;
    api.paperTerms(id).then((r) => {
      if (!live) return;
      if (pairs) termPairs.set(r);
      if (hints) void tick().then(() => void (live && dictHints.set(r, lang)));
    }).catch(() => {});
    return () => {
      live = false;
      termPairs.clear();
      dictHints.clear();
    };
  });
  /** @param {MouseEvent} e */
  function onTextMove(e) {
    termPairs.move(e);
    if (!device.touch) dictHints.move(e); // (a tap moves "the mouse" too: there the sheet opens instead)
  }

  // ---- The bottom bar's buttons held (a phone): a bookmark on the paragraph read, or a note to it ----
  $effect(() => {
    /** @param {Event} e */
    const onHere = (e) => {
      // (the player names the paragraph it reads; the bottom bar — the one at the top of the screen)
      const asked = /** @type {CustomEvent} */ (e).detail;
      const first = asked.ref ? null : article && scroller ? firstParagraph(article, scroller, device.mobile ? 64 : 8) : null;
      const ref = asked.ref ?? first?.ref;
      if (!ref) return;
      const anchor = { ref, lang: null, start: null, end: null, quote: null };
      const had = paperNotes.find((n) => n.ref === ref && n.lang === null);
      flashRef = null;
      void tick().then(() => {
        flashRef = ref; // (where it went)
        setTimeout(() => flashRef === ref && (flashRef = null), 2000);
      });
      if (asked.what === 'note') {
        // as «Комментарий» in the paragraph's menu: its conversation, or a new note's first words
        notes.activeId = had?.id ?? null;
        if (!had?.comments.length) notes.draft = { ...anchor, noteId: had?.id ?? null };
        return;
      }
      if (had?.bookmark) return showToast(`Закладка уже есть · ${ref}`);
      if (had) void patchNote(had.id, { bookmark: true });
      else void createNote(anchor, { bookmark: true });
      // «Отменить»: the note as it is by then (its number may have come from the server meanwhile) — a
      // note made just for the bookmark goes, one that had more keeps it
      showToast(`Закладка · ${ref}`, {
        label: 'Отменить',
        run: () => {
          const n = paperNotes.find((x) => x.ref === ref && x.lang === null);
          if (!n) return;
          if (had) void patchNote(n.id, { bookmark: false });
          else void deleteNote(n.id);
        },
      });
    };
    window.addEventListener('ub-here', onHere);
    return () => window.removeEventListener('ub-here', onHere);
  });

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
    // a word the dictionary marked: its article's card
    if (dictHints.tap(e, device.touch)) return void (tb = null);
    const n = settings.showNotes ? noteAt(e.clientX, e.clientY) : null;
    if (n) {
      notes.activeId = n.id;
      // with comments, the sheet alone opens (no rail); its "⋯" brings the actions
      if (showRail || n.comments.length === 0) openNoteToolbar(n);
      else tb = null;
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
    const text = article ? textElement(article, ref, main)?.textContent ?? '' : '';
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
    if (background) return;
    if (e.key === 'Escape' && (tb || pop)) {
      tb = null;
      pop = null;
      getSelection()?.removeAllRanges();
    }
  }
</script>

{#snippet paraPlay(/** @type {string} */ ref, /** @type {'ru' | 'en'} */ lang)}
  <!-- ▶: this paragraph in this language, with the player's voice; ■ while it is read -->
  {@const on = paragraphPlaying(ref, lang)}
  <button class="para-play" class:on data-lang={lang} onclick={(e) => (e.stopPropagation(), playParagraph(ref, lang))}
    aria-label={on ? 'Остановить' : lang === 'en' ? `Прослушать оригинал ${ref}` : `Прослушать абзац ${ref}`}
    title={on ? 'Остановить' : lang === 'en' ? 'Прослушать оригинал' : 'Прослушать абзац'}><Icon name={on ? 'stop-line' : 'play-line'} size={12} /></button>
{/snippet}

<svelte:window onkeydown={onKeydown} />

<div class="reader">
  <div class="reader-scroll" bind:this={scroller} onscroll={onScroll}
    use:swipeOpen={{ onleft: () => (bookNotes = true), onright: () => (bookSearch = true), enabled: canSwipe }}
    use:pinchFont={{ get: () => settings.fontSize, set: (px) => setSetting('fontSize', px), min: 14, max: 26, anchor: '.pair, h2, h3' }}
    use:edgePull={pullOpts}>
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
          onmousemove={onTextMove}
          onmouseleave={() => (termPairs.clear(), dictHints.leave())}
          onkeyup={(e) => e.shiftKey && onPointerUp(e)}
          onclick={onArticleClick}
        >
          {#if settings.dictHints && !isGuest}<HintLayer hints={dictHints} mark={settings.dictMark} {article} bind:layer={hintLayer} />{/if}
          {#each groups as s (s.num)}
            {#if s.num === 0}
              {#if paper.partStart}
                <!-- the part's title page, as in the printed book: before its first paper — its name and who sponsored it -->
                {@const intro = main === 'en' ? paper.partIntroEn || paper.partIntroRu : paper.partIntroRu}
                <section class="part-title" aria-label={partName(paper.partId)}>
                  <div class="part-title-label">{partName(paper.partId)}</div>
                  <div class="part-title-name" lang={main}>{main === 'en' ? paper.partTitleEn || paper.partTitleRu : paper.partTitleRu}</div>
                  {#if intro}<p class="part-title-intro" lang={main}>{intro}</p>{/if}
                  {#if enMode !== 'hidden' && main === 'ru' && paper.partIntroEn}<p class="part-title-intro en-intro" lang="en">{paper.partIntroEn}</p>{/if}
                </section>
              {/if}
              <header class="paper-head" id="s-{paper.id}:0" data-section="0">
                <!-- the Foreword stands before Part I and is not of it -->
                {#if !paper.partStart && paper.id !== 0}<div class="kicker">{partName(paper.partId)} · {main === 'en' ? paper.partTitleEn || paper.partTitleRu : paper.partTitleRu}</div>{/if}
                <h1>
                  {#if paper.id}<span class="paper-num">{paperLabel(paper.id)}</span>{/if}
                  <span data-tts={main} data-tts-key="h0" lang={main}>{titleIn(paper, main)}</span>
                </h1>
                {#if enMode !== 'hidden'}
                  <div class="en-title" lang="en">{paper.id ? `Paper ${paper.id} · ` : ''}<span data-tts="en" data-tts-key="h0">{paper.titleEn}</span></div>
                {/if}
              </header>
            {:else}
              <h2 class="section-head" id="s-{paper.id}:{s.num}" data-section={s.num}>
                <span><span class="sec-num">{sectionLabel(paper.id, s.num)}.</span> <span data-tts={main} data-tts-key="h{s.num}" lang={main}>{main === 'en' ? s.titleEn || s.titleRu : s.titleRu}</span></span>
                {#if enMode !== 'hidden'}<span class="en-title" lang="en" data-tts="en" data-tts-key="h{s.num}">{s.titleEn}</span>{/if}
              </h2>
            {/if}

            {#each s.paragraphs as p (p.ref)}
              {@const mk = markers.get(p.ref)}
              {@const paraNote = paperNotes.find((n) => n.ref === p.ref && n.lang === null)}
              {@const proposalsN = isGuest ? tr.guestProposals[p.ref] ?? 0 : proposalCounts.get(p.ref)?.length ?? 0}
              {@const messagesN = tr.messages[p.ref] ?? 0}
              {@const tasksN = taskCounts.get(p.ref) ?? 0}
              <div class="pair" class:flash={flashRef === p.ref} class:para-active={paraNote && paraNote.id === notes.activeId}
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
                  {#if !isGuest}{@render paraPlay(p.ref, main)}{/if}
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
                        <button class="gmark" title="Варианты перевода: {proposalsN}" onclick={() => (isGuest ? askLogin('варианты перевода') : openPublicThread(p.ref))}>
                          <Icon name="translate" size={13} /><span class="n">{proposalsN}</span>
                        </button>
                      {/if}
                      {#if messagesN}
                        <button class="gmark" title="Публичное обсуждение: {messagesN}" onclick={() => (isGuest ? askLogin('обсуждение') : discussInChat(p.ref))}>
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
                  <!-- the main text in the reading language; under it the comparison (the English under the Russian) -->
                  <p class="main-text" lang={main} data-ref={p.ref} data-lang={main} data-tts={main} data-tts-key={p.ref}>{@html main === 'ru' ? substituted.get(p.ref) ?? p.ru : p.en}</p>
                  {#if enMode !== 'hidden'}<div class="en-wrap">{#if !isGuest}{@render paraPlay(p.ref, 'en')}{/if}
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
                  </div>{/if}
                </div>
              </div>
            {/each}
          {/each}

          <nav class="pager">
            {#if data.prev !== null}<a href="/{data.prev}" onclick={linkClick}>← {paperLabel(data.prev)}</a>{:else}<span></span>{/if}
            {#if data.next !== null}<a href="/{data.next}" onclick={linkClick}>{paperLabel(data.next)} →</a>{/if}
          </nav>
        </article>
        {#if termPairs.tip}<div class="term-tip" lang={termPairs.tip.lang} style:left="{termPairs.tip.x}px" style:top="{termPairs.tip.y}px">{termPairs.tip.text}</div>{/if}
        {#if showRail && article}
          <MarginRail {article} items={railItems} />
        {/if}
      </div>
    {:else if loading}
      <div class="state">Загрузка…</div>
    {/if}
  </div>
  {#if pull && data}
    <!-- the pull past the edge: where it leads, filling up until it is enough -->
    {@const id = pull.dir === 'next' ? data.next : data.prev}
    {#if id !== null}
      <!-- (phone: at the page's top level — above the bars and a notice over the text) -->
      <div class="edge-pull {pull.dir}" class:ready={pull.p >= 1} style:--p={pull.p} aria-hidden="true" use:phonePortal>
        <Icon name={pull.dir === 'next' ? 'down' : 'up'} size={16} /><span>{paperLabel(id)}</span>
      </div>
    {/if}
  {/if}

  {#if sheetOpen}
    <!-- (phone: at the page's top level — the book's layer is not lifted or cut under it) -->
    <div class="note-sheet" use:phonePortal>
      {#if notes.draft}
        <NoteCard showQuote onclose={() => (notes.draft = null)} />
      {:else if activeNote}
        <NoteCard note={activeNote} showQuote onclose={() => (notes.activeId = null)}
          onactions={activeNote.lang !== null ? () => activeNote && noteActionsFor(activeNote) : undefined} />
      {/if}
    </div>
  {/if}

  {#if tb}
    <SelectionToolbar {tb} onclose={() => (tb = null)} ontranslate={translateSelection}
      onthread={() => tb && (isGuest ? askLogin('обсуждение') : discussInChat(tb.anchor.ref, tb.anchor.quote), (tb = null))} />
  {/if}
  {#if pop}
    <TranslationPopover {...pop} onclose={() => (pop = null)} />
  {/if}
  <!-- the phone: where in the book (the audio player has its own line while it is open) -->
  {#if device.mobile && !tts.open && !ui.sidebarOpen && !background}
    <ReadProgress paper={data?.paper.id ?? null} {scroller} {article} />
  {/if}
  <!-- the side panels: at the page's top level (over the bars), the book's layer untouched under them -->
  {#if bookNotes}<div class="over-book" use:portal><BookNotesPanel onclose={() => (bookNotes = false)} /></div>{/if}
  {#if bookSearch}<div class="over-book" use:portal><BookSearchPanel onclose={() => (bookSearch = false)} /></div>{/if}
</div>

{#if thread.ref}
  <ThreadDrawer ru={threadTexts?.ru ?? ''} en={threadTexts?.en ?? ''} />
{/if}
