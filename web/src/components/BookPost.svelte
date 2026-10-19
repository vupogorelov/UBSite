<script>
  import { book, inLang } from '../lib/lang.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { paperLabel } from '../lib/format.js';
  import Icon from './Icon.svelte';
  import Fold from './Fold.svelte';

  /**
   * A message of the Book anchored to its paragraph, inside its bubble: where it is in the book (a link),
   * the paper's title, the paragraph in the book's font, the English as the reader set it (in full,
   * folded to a line, or behind "English"), the page. In the channel — "Обсудить · N": its discussion
   * in the general chat.
   * @type {{
   *   post: { ref: string, ru: string, en: string, pageRef: string, paperId: number, paperTitle: string, paperTitleEn?: string },
   *   comments?: number, ondiscuss?: () => void
   * }}
   */
  let { post, comments = 0, ondiscuss } = $props();

  let showEn = $state(settings.enMode !== 'hidden');
  let open = $state(false);
  const folding = $derived(settings.enMode === 'collapsed');
</script>

<div class="book-post">
  <a class="book-post-head" href="/{post.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${post.ref}`))} title="Открыть в книге">
    <Icon name="book-open" size={13} />{paperLabel(post.paperId)} · {post.ref}
  </a>
  <div class="book-post-title" lang={book.main}>{book.main === 'en' ? post.paperTitleEn || post.paperTitle : post.paperTitle}</div>
  <Fold on={settings.chatFold} cls="book-post-text" lang={book.main}>{@html inLang(post, book.main)}</Fold>
  {#if post.en && book.main === 'ru'}
    {#if showEn}
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
      <div class="book-post-en" class:collapsible={folding} class:expanded={open} lang="en"
        onclick={(e) => folding && (e.stopPropagation(), (open = !open))}>{@html post.en}</div>
    {:else}
      <button class="tg-post-en-toggle" onclick={(e) => (e.stopPropagation(), (showEn = true))}>English</button>
    {/if}
  {/if}
  <div class="book-post-foot">
    {#if ondiscuss}
      <button class="book-post-discuss" onclick={(e) => (e.stopPropagation(), ondiscuss())}>
        <Icon name="discuss" size={15} />Обсудить{#if comments} · {comments}{/if}
      </button>
    {/if}
    {#if post.pageRef}<span class="muted" title="Страница.абзац печатного издания">стр. {post.pageRef}</span>{/if}
    <span class="spacer"></span>
  </div>
</div>
