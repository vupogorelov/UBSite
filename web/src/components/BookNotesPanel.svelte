<script>
  import { feedReady } from '../lib/feed.js';
  import { notes, colorName, allNotes, patchNote, createNote } from '../lib/notes.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { can } from '../lib/session.svelte.js';
  import { navigate, onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';
  import { paperLabel } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /**
   * The book's notes from the right (a swipe to the left over the text, phone and tablet): bookmarks or
   * comments of the whole workspace, in the order of the book, by paper. A tap goes to the place —
   * a comment opens its conversation there.
   * @type {{ onclose: () => void }}
   */
  let { onclose } = $props();
  $effect(() => onBack(() => onclose()));

  /** Each opening starts with the bookmarks. */
  let kind = $state(/** @type {'comments' | 'bookmarks'} */ ('bookmarks'));

  let all = $state(/** @type {import('../lib/api.js').Note[] | null} */ (null));
  // (the workspace's notes kept on the device — the feed — with what still waits to be sent)
  $effect(() => {
    void notes.version;
    feedReady().then(() => (all = allNotes()));
  });

  /** @type {import('../lib/api.js').Note[]} */
  const shown = $derived((all ?? []).filter((n) => (kind === 'comments' ? n.comments.length > 0 : n.bookmark)));
  /** The list by paper (already in the order of the book). */
  const papers = $derived(
    shown.reduce((out, n) => {
      const id = n.paperId ?? -1;
      if (out.at(-1)?.id !== id) out.push({ id, title: n.paperTitle, items: [] });
      /** @type {any} */ (out.at(-1)).items.push(n);
      return out;
    }, /** @type {{ id: number, title: string | null, items: import('../lib/api.js').Note[] }[]} */ ([])),
  );
  const counts = $derived({
    comments: (all ?? []).filter((n) => n.comments.length).length,
    bookmarks: (all ?? []).filter((n) => n.bookmark).length,
  });

  // The bin on a bookmark: away at once, as «Закладка» in the text's actions does (its name and color go;
  // a note with nothing else is removed by the server) — and «Вернуть» for a few seconds brings it back
  /** @param {import('../lib/api.js').Note} n */
  function removeBookmark(n) {
    const kept = n.comments.length > 0 || n.tags.length > 0; // (the note stays without its bookmark)
    /** @type {any} */
    const back = { bookmark: true, color: n.color ?? undefined, title: n.title };
    void patchNote(n.id, { bookmark: false });
    showToast('Закладка удалена', {
      label: 'Вернуть',
      run: () =>
        void (kept ? patchNote(n.id, back) : createNote({ ref: n.ref, lang: n.lang, start: n.start, end: n.end, quote: n.quote }, back)),
    });
  }

  /** @param {import('../lib/api.js').Note} n */
  function go(n) {
    onclose();
    navigate(`/${n.ref}`);
    if (kind === 'comments') notes.activeId = n.id;
  }
</script>

<button class="drawer-scrim book-notes-scrim" aria-label="Закрыть" onclick={onclose}></button>
<aside class="book-notes side-panel" aria-label="Заметки книги" use:swipeClose={{ dirs: ['right'], onclose }}>
  <header class="side-head">
    <b>Заметки</b>
    <button class="ui-round plain" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
  </header>
  <div class="ui-chips side-chips" role="radiogroup" aria-label="Что показать">
    <button class="ui-chip" class:on={kind === 'bookmarks'} role="radio" aria-checked={kind === 'bookmarks'} onclick={() => (kind = 'bookmarks')}>
      Закладки<span class="side-n">{counts.bookmarks}</span>
    </button>
    <button class="ui-chip" class:on={kind === 'comments'} role="radio" aria-checked={kind === 'comments'} onclick={() => (kind = 'comments')}>
      Комментарии<span class="side-n">{counts.comments}</span>
    </button>
  </div>
  <div class="side-list">
    {#if all === null}
      <p class="ui-hint">Загрузка…</p>
    {:else if !shown.length}
      <div class="ui-empty">
        <span class="ui-tile big"><Icon name={kind === 'comments' ? 'comment' : 'bookmark'} size={22} /></span>
        <b>{kind === 'comments' ? 'Комментариев пока нет' : 'Закладок пока нет'}</b>
        <p class="muted small">Выделите текст — появится панель с закладкой и комментарием.</p>
      </div>
    {:else}
      {#each papers as p (p.id)}
        <div class="side-group">{p.id >= 0 ? paperLabel(p.id) : ''}{p.title && p.title !== paperLabel(p.id) ? ` · ${p.title}` : ''}</div>
        <div class="ui-cards side-cards">
          {#each p.items as n (n.id)}
            <div class="side-card-wrap">
            <button class="ui-card side-card" class:with-del={kind === 'bookmarks' && can.edit} class:active={notes.activeId === n.id} onclick={() => go(n)}>
              <span class="ui-tile" data-color={kind === 'bookmarks' ? n.color : null} title={kind === 'bookmarks' && n.color ? colorName(n.color) : undefined}>
                <Icon name={kind === 'comments' ? 'comment' : 'bookmark'} size={18} />
              </span>
              <span class="ui-card-body">
                {#if kind === 'bookmarks' && n.title}
                  <span class="ui-card-title">{n.title}</span>
                  <span class="ui-card-meta"><b>{n.ref}</b></span>
                  <span class="ui-card-quote" lang={n.lang ?? 'ru'}>{n.quote ?? 'Весь абзац'}</span>
                {:else}
                  <span class="ui-card-meta"><b>{n.ref}</b>{#if n.resolved} · Решено{/if}</span>
                  <span class="ui-card-quote side-quote" lang={n.lang ?? 'ru'}>{n.quote ?? 'Весь абзац'}</span>
                {/if}
                {#if kind === 'comments'}
                  <span class="ui-card-text"><b>{n.comments[0].authorName ?? ''}</b> {n.comments[0].body}</span>
                  {#if n.comments.length > 1}
                    <span class="ui-card-foot"><span class="ui-card-count"><Icon name="comment" size={13} />{n.comments.length}</span></span>
                  {/if}
                {/if}
              </span>
            </button>
            {#if kind === 'bookmarks' && can.edit}
              <button class="ui-round side-del" onclick={() => removeBookmark(n)} title="Удалить закладку"
                aria-label="Удалить закладку {n.ref}"><Icon name="trash" size={18} /></button>
            {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</aside>
