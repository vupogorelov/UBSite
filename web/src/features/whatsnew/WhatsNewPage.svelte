<script>
  import { navigate } from '../../lib/router.svelte.js';
  import { whatsNew, loadWhatsNew, markSeen, dateText } from './whatsnew.svelte.js';

  /** «Что нового» (/whatsnew): the changes in plain words by date, the newest first; opened — all seen. */
  $effect(() => {
    void loadWhatsNew().then(markSeen);
  });

  /** Links to app pages ("/5:1.3", "/d") open in the app. @param {MouseEvent} e */
  function onClick(e) {
    const href = /** @type {HTMLElement} */ (e.target).closest('a')?.getAttribute('href');
    if (!href?.startsWith('/') || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
  }
</script>

<div class="about-page">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <article class="markdown-body wn" onclick={onClick}>
    <h1>Что нового</h1>
    {#if !whatsNew.loaded}
      <p class="muted">Загрузка…</p>
    {:else if !whatsNew.entries.length}
      <p class="muted">Пока ничего.</p>
    {/if}
    {#each whatsNew.entries as e (e.date)}
      <section class="wn-entry">
        <h2>{dateText(e.date)}</h2>
        {@html e.html}
      </section>
    {/each}
  </article>
</div>

<style>
  .wn h2 {
    margin-top: var(--space-6);
  }
  .wn-entry :global(li) {
    margin-bottom: var(--space-2);
  }
</style>
