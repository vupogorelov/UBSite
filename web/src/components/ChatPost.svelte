<script>
  import { navigate } from '../lib/router.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { paperLabel } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /**
   * A paragraph under discussion, drawn like a Telegram channel post: the channel-style header with
   * an accent bar, the text in the book's font, the English below, the page in the footer and the
   * round "→" button on the side (here: open in the book). The discussion follows as its comments.
   * @type {{
   *   ref: string, paperId?: number | null, paperTitle?: string | null, pageRef?: string | null,
   *   ru?: string, en?: string, plain?: boolean, comments?: number, children?: import('svelte').Snippet
   * }}
   * `plain`: ru/en are plain text, not the book's HTML.
   */
  let { ref, paperId = null, paperTitle = null, pageRef = null, ru = '', en = '', plain = false, comments = 0, children } = $props();
  let showEn = $state(settings.enMode === 'full');
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
      {#if children}{@render children()}{:else if plain}{ru}{:else}{@html ru}{/if}
    </div>
    {#if en}
      {#if showEn}
        <div class="tg-post-en" lang="en">{#if plain}{en}{:else}{@html en}{/if}</div>
      {:else}
        <button class="tg-post-en-toggle" onclick={() => (showEn = true)}>English</button>
      {/if}
    {/if}
    <footer class="tg-post-foot">
      {#if comments}<span title="Сообщений в обсуждении"><Icon name="comment" size={13} />{comments}</span>{/if}
      {#if pageRef}<span title="Страница.абзац печатного издания">стр. {pageRef}</span>{/if}
    </footer>
  </article>
  <button class="tg-post-go" onclick={() => navigate(`/${ref}`)} title="Открыть в книге" aria-label="Открыть абзац {ref} в книге">
    <Icon name="back" size={18} />
  </button>
</div>
