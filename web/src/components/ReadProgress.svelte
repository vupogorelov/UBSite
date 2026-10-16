<script>
  import { tick } from 'svelte';
  import { navigate } from '../lib/router.svelte.js';
  import { bookMap, loadBook, bookShare, locate } from '../lib/bookmap.svelte.js';
  import { firstParagraph } from '../lib/onscreen.js';

  /**
   * The phone's reading progress line above the bottom navigation, like the audio player's: the share
   * of the book up to the first paragraph on screen; dragging the knob opens that place.
   * @type {{ paper: number | null, scroller: HTMLElement | undefined, article: HTMLElement | undefined }}
   */
  let { paper, scroller, article } = $props();

  $effect(() => loadBook());

  let share = $state(/** @type {number | null} */ (null));
  let drag = $state(/** @type {number | null} */ (null));
  /** A place in another paper: reached once that paper is on screen. @type {{ paper: number, idx: number } | null} */
  let pending = null;

  const paragraphs = () => /** @type {HTMLElement[]} */ ([...(article?.querySelectorAll('.pair[id^="p-"]') ?? [])]);

  /** The first paragraph below the top bar, and how far into it the screen is. */
  function measure() {
    if (!scroller || !article || paper === null || !bookMap.ready) return;
    const first = firstParagraph(article, scroller, 64);
    if (first) share = bookShare(paper, first.inside);
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => ((ticking = false), measure()));
  };
  $effect(() => {
    const box = scroller;
    box?.addEventListener('scroll', onScroll, { passive: true });
    return () => box?.removeEventListener('scroll', onScroll);
  });

  // A new paper on screen (or the map just loaded): measure, or go to the place asked for there.
  $effect(() => {
    const id = paper;
    void bookMap.ready;
    tick().then(() =>
      setTimeout(() => {
        if (pending && pending.paper === id) {
          const idx = pending.idx;
          pending = null;
          paragraphs()[idx]?.scrollIntoView({ block: 'start' });
        }
        measure();
      }, 0),
    );
  });

  /** @param {number} frac */
  function drop(frac) {
    drag = null;
    const t = locate(frac);
    if (!t) return;
    share = frac;
    if (t.paper === paper) paragraphs()[t.idx]?.scrollIntoView({ block: 'start' });
    else {
      pending = t;
      navigate(`/${t.paper}`);
    }
  }

  const shown = $derived(drag ?? share ?? 0);
  const target = $derived(drag === null ? null : locate(drag));
  /** @param {number} f */
  const pct = (f) => (Math.round(f * 1000) / 10).toLocaleString('ru');
</script>

{#if bookMap.ready}
  <div class="read-progress tts-progress">
    <input type="range" min="0" max="1000" step="1" value={Math.round(shown * 1000)} style:--done="{shown * 100}%"
      aria-label="Место в книге" aria-valuetext="{pct(shown)}%{target ? `, Текст ${target.paper}` : ''}"
      oninput={(e) => (drag = Number(e.currentTarget.value) / 1000)}
      onchange={(e) => drop(Number(e.currentTarget.value) / 1000)} />
    {#if drag !== null && target}<span class="tts-seek-tip" style:left="clamp(56px, {shown * 100}%, calc(100% - 96px))">Текст {target.paper} · {pct(shown)}%</span>{/if}
    <span class="tts-pct">{pct(shown)}%</span>
  </div>
{/if}
