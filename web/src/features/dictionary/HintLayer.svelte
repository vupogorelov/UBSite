<script>
  import { navigate } from '../../lib/router.svelte.js';
  import { book } from '../../lib/lang.svelte.js';
  import { kindName } from './api.js';
  import Icon from '../../components/Icon.svelte';

  /**
   * The dictionary's marks over the text (hints.svelte.js): a dot over a marked word or a thin line under
   * it; the card of the article under the mouse. Stands first in the paper's article, of no height, so
   * the marks scroll with the text; they take no clicks — the text under them does.
   * @type {{
   *   hints: ReturnType<typeof import('./hints.svelte.js').createDictHints>,
   *   mark: 'dot' | 'line',
   *   article: HTMLElement | null | undefined,
   *   layer?: HTMLElement | null,
   * }}
   */
  let { hints, mark, article, layer = $bindable(null) } = $props();

  // the text moves (the column's width, the font, an English paragraph opened): the marks follow
  $effect(() => {
    if (!article) return;
    const ro = new ResizeObserver(() => hints.place());
    ro.observe(article);
    return () => ro.disconnect();
  });
  // the page scrolls: the card (fixed over the screen) goes
  $effect(() => {
    const off = () => hints.card && hints.clear();
    document.addEventListener('scroll', off, true);
    return () => document.removeEventListener('scroll', off, true);
  });
</script>

<div class="dict-layer" data-mark={mark} bind:this={layer} aria-hidden="true">
  {#each hints.spots as s (s.id)}
    {#if mark === 'dot'}
      {@const b = s.boxes[0]}
      <span class="dict-dot" style:left="{b.x + b.w / 2}px" style:top="{b.y}px"></span>
    {:else}
      {#each s.boxes as b, i (i)}<span class="dict-line" style:left="{b.x}px" style:top="{b.y + b.h}px" style:width="{b.w}px"></span>{/each}
    {/if}
  {/each}
</div>
{#if hints.card}
  {@const a = hints.card.item}
  {@const en = book.main === 'en'}
  <div class="dict-card" role="region" aria-label={a.nameRu} style:left="{hints.card.x}px" style:top="{hints.card.y}px"
    onmouseenter={hints.keep} onmouseleave={hints.leave}>
    <span class="dict-card-kind">{kindName(a.kind)}</span>
    <b class="dict-card-name">{en && a.nameEn ? a.nameEn : a.nameRu}</b>
    {#if !en && a.nameEn}<span class="muted dict-card-en" lang="en">{a.nameEn}</span>{/if}
    {#if (en && a.briefEn) || a.briefRu}<p class="dict-card-brief">{en && a.briefEn ? a.briefEn : a.briefRu}</p>{/if}
    <a class="dict-card-more" href="/d/{a.id}" onclick={(e) => {
      e.preventDefault();
      const to = `/d/${a.id}`; // (before the card goes)
      hints.clear();
      navigate(to);
    }}>Подробнее в словаре<Icon name="chevron" size={14} /></a>
  </div>
{/if}

<style>
  .dict-layer {
    /* the orange of the pairs of terms, quieter */
    --dict-mark: color-mix(in srgb, #d97706 70%, transparent);
    position: relative;
    height: 0;
    pointer-events: none;
  }
  .dict-dot,
  .dict-line {
    position: absolute;
    background: var(--dict-mark);
  }
  /* a dot over the word's middle, just above its letters */
  .dict-dot {
    width: 0.27em;
    height: 0.27em;
    border-radius: 50%;
    translate: -50% 35%;
  }
  /* a thin line just under the letters */
  .dict-line {
    height: 1px;
    translate: 0 -0.12em;
  }
  .dict-card {
    position: fixed;
    z-index: 45;
    display: grid;
    gap: 4px;
    width: min(340px, calc(100vw - 16px));
    padding: 12px 14px;
    border: 1px solid var(--ui-line);
    border-radius: 16px;
    background: var(--surface);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.3);
    color: var(--text);
    font-family: var(--sans);
  }
  .dict-card-kind {
    color: var(--muted);
    font: 500 11px/14px var(--sans);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dict-card-name {
    font: 600 16px/22px var(--sans);
  }
  .dict-card-en {
    margin-top: -4px;
    font: 13px/18px var(--sans);
  }
  .dict-card-brief {
    margin: 0;
    font: 14px/1.5 var(--text-font, var(--serif));
  }
  .dict-card-more {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    justify-self: start;
    margin-top: 2px;
    color: var(--accent);
    font: 500 14px/20px var(--sans);
    text-decoration: none;
  }
  .dict-card-more:hover {
    text-decoration: underline;
  }
</style>
