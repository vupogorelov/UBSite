<script module>
  /**
   * One observer for every folded text: its callback comes after the layout, for all the texts at once — a
   * text measured on its own as it is made forced the layout per message (a long conversation opened late).
   * @type {Map<Element, () => void>}
   */
  const watched = new Map();
  /** @type {ResizeObserver | null} */
  let observer = null;
  /** @param {Element} el @param {() => void} fn */
  function watch(el, fn) {
    observer ??= new ResizeObserver((entries) => entries.forEach((e) => watched.get(e.target)?.()));
    watched.set(el, fn);
    observer.observe(el);
    return () => (watched.delete(el), observer?.unobserve(el));
  }
</script>

<script>
  /**
   * A long text folded to its first lines (Settings → «Чаты»: «Сворачивать длинные сообщения»): the last of them
   * fading, «Показать полностью» under it — unfolded in place; «Свернуть» — back. A text that fits stays as it is.
   * `cls`: the text's own class (its font: the lines are counted in its line height); none, and off — the text
   * alone, nothing around it.
   * @type {{ on?: boolean, lines?: number, cls?: string, lang?: string, children: import('svelte').Snippet }}
   */
  let { on = true, lines = 5, cls = '', lang, children } = $props();

  let open = $state(false);
  /** It does not fit in its lines. */
  let over = $state(false);
  /** @type {HTMLElement | undefined} */
  let box = $state();

  $effect(() => {
    if (!on || open || !box) return;
    const el = box;
    // (measured by the observer only: its first call comes after the layout — no measuring as it is made)
    return watch(el, () => (over = el.scrollHeight > el.clientHeight + 2));
  });
</script>

<!-- (no blanks between the tags: in a message's text, white space shows — as an empty line) -->
{#if on || cls}<div bind:this={box} class={cls} {lang} class:fold={on} class:folded={on && !open} class:over={on && over && !open} style:--fold-lines={lines}>{@render children()}</div>{#if on && (over || open)}<button
      class="fold-btn" onclick={(e) => (e.stopPropagation(), (open = !open))}>{open ? 'Свернуть' : 'Показать полностью'}</button>{/if}{:else}
  {@render children()}
{/if}
