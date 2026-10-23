<script>
  import Icon from './Icon.svelte';

  /**
   * A small round ⓘ that tells how something works (a toggletip): a tap shows its words, a tap again or
   * elsewhere (or Esc) hides them; with a mouse also on hover. The words are a popover, opened by the ⓘ
   * itself (popovertarget: the browser toggles it, the ⓘ is not "elsewhere") — over everything, never cut by
   * the card it stands in; placed above the ⓘ (below, if there is no room), within the screen.
   * @type {{ text: string, label?: string }}
   */
  let { text, label = 'Как это работает' } = $props();

  const id = $props.id();
  /** @type {HTMLButtonElement | undefined} */ let btn = $state();
  /** @type {HTMLElement | undefined} */ let tip = $state();
  let open = $state(false);
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;

  function place() {
    if (!btn || !tip) return;
    const b = btn.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(Math.max(8, b.left + b.width / 2 - t.width / 2), innerWidth - t.width - 8);
    const above = b.top - t.height - gap;
    tip.style.left = `${left}px`;
    tip.style.top = `${above >= 8 ? above : b.bottom + gap}px`;
  }
</script>

<button bind:this={btn} type="button" class="info-tip" class:on={open} popovertarget="{id}-tip" aria-label={label} aria-describedby="{id}-tip"
  onmouseenter={() => hover && !open && tip?.showPopover()} onmouseleave={() => hover && open && tip?.hidePopover()}>
  <Icon name="info" size={14} />
</button>
<span bind:this={tip} id="{id}-tip" class="info-tip-text" popover="auto" role="tooltip"
  ontoggle={(e) => ((open = /** @type {any} */ (e).newState === 'open'), open && place())}>{text}</span>
