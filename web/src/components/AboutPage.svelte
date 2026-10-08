<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import { navigate } from '../lib/router.svelte.js';

  /** "О приложении" (/about): the project's about.md, rendered like a README on GitHub. */

  let html = $state('');
  let error = $state('');
  onMount(() => {
    api.about().then(
      (r) => (html = renderMarkdown(r.markdown, '/api/')), // "about/x.webp" in about.md → /api/about/x.webp
      (err) => (error = err.message),
    );
  });

  /** Links to app pages ("/5:1.3") open in the app; others in a new tab (set by the renderer). @param {MouseEvent} e */
  function onClick(e) {
    const href = /** @type {HTMLElement} */ (e.target).closest('a')?.getAttribute('href');
    if (!href?.startsWith('/') || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
  }
</script>

<div class="about-page">
  {#if error}
    <p class="muted pad">{error}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <article class="markdown-body" onclick={onClick}>{@html html}</article>
  {/if}
</div>
