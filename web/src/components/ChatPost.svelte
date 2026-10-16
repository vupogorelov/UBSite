<script>
  import { book } from '../lib/lang.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { paperLabel } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /**
   * A paragraph under discussion, drawn like a Telegram channel post: the channel-style header with
   * an accent bar, the text in the book's font, the English below, the page in the footer (the book is
   * one tap away in the chat's header). The discussion follows as its comments.
   * @type {{
   *   ref: string, paperId?: number | null, paperTitle?: string | null, pageRef?: string | null,
   *   ru?: string, en?: string, plain?: boolean, comments?: number, children?: import('svelte').Snippet
   * }}
   * `plain`: ru/en are plain text, not the book's HTML.
   */
  let { ref, paperId = null, paperTitle = null, pageRef = null, ru = '', en = '', plain = false, comments = 0, children } = $props();
  // The English as in the book (the reader's "Английский оригинал"): in full; folded to one line that a
  // tap opens and closes; hidden — then the "English" button shows it.
  let showEn = $state(settings.enMode !== 'hidden');
  /** Reading in English: the post is the English, with no comparison under it. */
  const english = $derived(book.main === 'en' && !children);
  let open = $state(false);
  const folding = $derived(settings.enMode === 'collapsed');
  const toggle = () => folding && (open = !open);
</script>

<div class="tg-post-row">
  <span class="tg-post-avatar" aria-hidden="true">§</span>
  <article class="tg-post">
    <header class="tg-post-head">
      <span class="tg-post-channel">Абзац {ref}</span>
      {#if paperId !== null}<span class="tg-post-label">{paperLabel(paperId)}</span>{/if}
    </header>
    {#if paperTitle}<div class="tg-post-title">{paperTitle}</div>{/if}
    <div class="tg-post-text">
      <!-- the reading language (the translation panel's own text — `children` — is the Russian it is about) -->
      {#if children}{@render children()}{:else if english && plain}{en}{:else if english}{@html en}{:else if plain}{ru}{:else}{@html ru}{/if}
    </div>
    {#if en && !english}
      {#if showEn}
        {#if folding}
          <div class="tg-post-en collapsible" class:expanded={open} lang="en" role="button" tabindex="0"
            aria-expanded={open} title={open ? 'Свернуть' : 'Развернуть'} onclick={toggle}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
          >{#if plain}{en}{:else}{@html en}{/if}</div>
        {:else}
          <div class="tg-post-en" lang="en">{#if plain}{en}{:else}{@html en}{/if}</div>
        {/if}
      {:else}
        <button class="tg-post-en-toggle" onclick={() => (showEn = true)}>English</button>
      {/if}
    {/if}
    <footer class="tg-post-foot">
      {#if comments}<span title="Сообщений в обсуждении"><Icon name="comment" size={13} />{comments}</span>{/if}
      {#if pageRef}<span title="Страница.абзац печатного издания">стр. {pageRef}</span>{/if}
    </footer>
  </article>
</div>
