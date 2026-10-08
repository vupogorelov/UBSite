<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { route, view, linkClick } from '../lib/router.svelte.js';
  import { partLabel, sectionLabel } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /** @type {{ toc: import('../lib/api.js').Toc, onnavigate?: () => void }} */
  let { toc, onnavigate } = $props();

  const papersByPart = $derived(Map.groupBy(toc.papers, (p) => p.partId));
  const sectionsByPaper = $derived(Map.groupBy(toc.sections, (s) => s.paperId));
  const currentPaper = $derived(view.paper ?? route.paper);
  const openParts = new SvelteSet();
  /** @type {HTMLElement} */
  let nav;

  // Expand the part that contains the paper being read.
  $effect(() => {
    const p = toc.papers.find((x) => x.id === currentPaper);
    if (p) openParts.add(p.partId);
  });

  // Keep the current entry visible in the tree.
  $effect(() => {
    void view.section, currentPaper;
    (nav.querySelector('.current-section') ?? nav.querySelector('.current-paper'))?.scrollIntoView({ block: 'nearest' });
  });

  /** @param {number} id */
  function togglePart(id) {
    if (openParts.has(id)) openParts.delete(id);
    else openParts.add(id);
  }

  /** @param {MouseEvent} e */
  function click(e) {
    linkClick(e);
    onnavigate?.();
  }
</script>

<nav class="toc" bind:this={nav} aria-label="Оглавление">
  {#each toc.parts as part (part.id)}
    {@const open = openParts.has(part.id)}
    <button class="toc-part" aria-expanded={open} onclick={() => togglePart(part.id)}>
      <span class="chev" class:open><Icon name="chevron" /></span>
      <span>
        <span class="toc-part-num">Часть {partLabel(part.id)}</span>
        <span class="toc-part-title">{part.titleRu}</span>
      </span>
    </button>
    {#if open}
      <ul>
        {#each papersByPart.get(part.id) ?? [] as p (p.id)}
          {@const current = p.id === currentPaper}
          <li>
            <a href="/{p.id}" onclick={click} class="toc-paper" class:current-paper={current}
              aria-current={current ? 'page' : undefined}>
              <span class="num">{p.id === 0 ? '' : p.id}</span><span>{p.titleRu}</span>
            </a>
            {#if current}
              <ul class="toc-sections">
                {#each sectionsByPaper.get(p.id) ?? [] as s (s.num)}
                  <li>
                    <a href="/{p.id}:{s.num}" onclick={click} class:current-section={view.section === s.num}>
                      <span class="num">{sectionLabel(p.id, s.num)}.</span><span>{s.titleRu}</span>
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/each}
</nav>
