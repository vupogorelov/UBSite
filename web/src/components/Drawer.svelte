<script>
  import Icon from './Icon.svelte';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';

  /**
   * `actions`: extra buttons in the header, before "close".
   * `onback`: the drawer shows an inner page — "←" before the title, and "back" returns from the page.
   * Closes by its button, the scrim, "back" (Android gesture/button) or a swipe right / down from the top.
   * @type {{ title: string, subtitle?: string, wide?: boolean, onclose: () => void, onback?: (() => void) | null, children: import('svelte').Snippet, actions?: import('svelte').Snippet }}
   */
  let { title, subtitle, wide = false, onclose, onback = null, children, actions } = $props();

  $effect(() =>
    onBack(() => {
      if (onback) onback();
      else onclose();
    }),
  );
</script>

<button class="drawer-scrim" aria-label="Закрыть" onclick={onclose}></button>
<div class="drawer" class:wide class:with-back={!!onback} role="dialog" aria-modal="true" aria-label={title} use:swipeClose={{ dirs: ['right', 'down'], onclose }}>
  <header class="drawer-head">
    {#if onback}<button class="ui-round plain drawer-back" onclick={onback} aria-label="Назад" title="Назад"><Icon name="back" /></button>{/if}
    <div class="drawer-title">
      <h2>{title}</h2>
      {#if subtitle}<div class="drawer-sub">{subtitle}</div>{/if}
    </div>
    <div class="drawer-actions">
      {@render actions?.()}
      <button class="ui-round plain" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
    </div>
  </header>
  {@render children()}
</div>
