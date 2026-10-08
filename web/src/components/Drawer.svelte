<script>
  import Icon from './Icon.svelte';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';

  /**
   * `actions`: extra buttons in the header, before "close".
   * Closes by its button, the scrim, "back" (Android gesture/button) or a swipe right / down from the top.
   * @type {{ title: string, subtitle?: string, wide?: boolean, onclose: () => void, children: import('svelte').Snippet, actions?: import('svelte').Snippet }}
   */
  let { title, subtitle, wide = false, onclose, children, actions } = $props();

  $effect(() => onBack(() => onclose()));
</script>

<button class="drawer-scrim" aria-label="Закрыть" onclick={onclose}></button>
<div class="drawer" class:wide role="dialog" aria-modal="true" aria-label={title} use:swipeClose={{ dirs: ['right', 'down'], onclose }}>
  <header class="drawer-head">
    <div>
      <h2>{title}</h2>
      {#if subtitle}<div class="muted small">{subtitle}</div>{/if}
    </div>
    <div class="drawer-actions">
      {@render actions?.()}
      <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
    </div>
  </header>
  {@render children()}
</div>
