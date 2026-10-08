<script>
  import { tick } from 'svelte';
  import { notes } from '../lib/notes.svelte.js';
  import { anchorRange } from '../lib/highlight.js';
  import NoteCard from './NoteCard.svelte';

  /**
   * Comment cards beside the text, each aligned with its fragment (Google Docs style).
   * @type {{ article: HTMLElement, items: import('../lib/api.js').Note[] }}
   */
  let { article, items } = $props();

  /** @type {HTMLElement} */
  let rail;
  const GAP = 8;

  /** @param {{ ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null }} a */
  function anchorTop(a) {
    if (a.lang && a.start !== null && a.end !== null) {
      const r = anchorRange(article, a.ref, a.lang, a.start, a.end)?.getBoundingClientRect();
      // An empty rectangle: the fragment is hidden (e.g. replaced by the reader's own variant) — use the paragraph.
      if (r && (r.width || r.height)) return r.top;
    }
    return document.getElementById(`p-${a.ref}`)?.getBoundingClientRect().top ?? null;
  }

  /** Positions cards: the active one sits exactly at its anchor, the others make room around it. */
  function layout() {
    if (!rail) return;
    const railTop = rail.getBoundingClientRect().top;
    const entries = [];
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (rail.querySelectorAll('[data-card]'))) {
      const key = el.dataset.card;
      const anchor = key === 'draft' ? notes.draft : items.find((n) => String(n.id) === key);
      const top = anchor ? anchorTop(anchor) : null;
      if (top === null) {
        el.style.visibility = 'hidden';
        continue;
      }
      entries.push({ el, key, top: top - railTop, h: el.offsetHeight, y: 0 });
    }
    entries.sort((a, b) => a.top - b.top);
    const activeKey = notes.draft ? 'draft' : String(notes.activeId);
    const ai = entries.findIndex((e) => e.key === activeKey);
    if (ai < 0) {
      let next = -Infinity;
      for (const e of entries) {
        e.y = Math.max(e.top, next);
        next = e.y + e.h + GAP;
      }
    } else {
      entries[ai].y = entries[ai].top;
      for (let i = ai + 1; i < entries.length; i++) entries[i].y = Math.max(entries[i].top, entries[i - 1].y + entries[i - 1].h + GAP);
      for (let i = ai - 1; i >= 0; i--) entries[i].y = Math.min(entries[i].top, entries[i + 1].y - entries[i].h - GAP);
    }
    for (const e of entries) {
      const first = e.el.dataset.placed !== '1';
      // A new card appears in place; only cards already shown glide when neighbours push them.
      if (first) e.el.style.transition = 'none';
      e.el.style.transform = `translateY(${Math.round(e.y)}px)`;
      e.el.style.visibility = 'visible';
      if (first) {
        void e.el.offsetHeight; // apply the position before transitions come back
        e.el.style.transition = '';
        e.el.dataset.placed = '1';
      }
    }
  }

  // Re-layout when cards change or when text reflows (font size, column width, English mode…).
  $effect(() => {
    void items, notes.activeId, notes.draft;
    tick().then(layout);
  });
  $effect(() => {
    const ro = new ResizeObserver(() => layout());
    ro.observe(article);
    ro.observe(rail);
    const mo = new MutationObserver(() => {
      for (const el of rail.querySelectorAll('[data-card]')) ro.observe(el);
    });
    mo.observe(rail, { childList: true });
    for (const el of rail.querySelectorAll('[data-card]')) ro.observe(el);
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  });
</script>

<aside class="rail" bind:this={rail} aria-label="Комментарии">
  {#each items as note (note.id)}
    <div class="rail-card" data-card={note.id}>
      <NoteCard {note} />
    </div>
  {/each}
  {#if notes.draft}
    <div class="rail-card" data-card="draft">
      <NoteCard />
    </div>
  {/if}
</aside>
