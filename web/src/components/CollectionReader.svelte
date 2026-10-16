<script>
  import { book, inLang } from '../lib/lang.svelte.js';
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { collections } from '../lib/collections.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { linkClick, navigate, lastPath } from '../lib/router.svelte.js';
  import { anchorRange, setRanges, clearHighlights } from '../lib/highlight.js';
  import { formatTime } from '../lib/notes.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import Icon from './Icon.svelte';
  import { plural } from '../lib/format.js';

  /**
   * A collection read as one text: its items in order — section titles, the compiler's notes,
   * paragraphs with their comments — each linking back to its place in the book.
   * @type {{ id: number }}
   */
  let { id } = $props();

  let data = $state(/** @type {import('../lib/api.js').CollectionFull | null} */ (null));
  let error = $state('');
  /** @type {HTMLElement | undefined} */ let article = $state();

  $effect(() => {
    void collections.version;
    api.collection(id).then(
      (c) => ((data = c), (error = ''), (document.title = `${c.title} — Urantia Papers Explorer`)),
      (err) => ((data = null), (error = err.message)),
    );
    return () => (document.title = 'Urantia Papers Explorer');
  });

  /**
   * Items folded to their fragment (by the item, or by the whole collection) that the reader opened
   * for now — only here and until the page is reloaded.
   * @type {Record<number, boolean>}
   */
  let unfolded = $state({});
  /** @param {import('../lib/api.js').CollectionItem} it */
  const foldable = (it) => !!it.fragment && (!!data?.fragmentsOnly || it.collapsed);
  /** @param {import('../lib/api.js').CollectionItem} it */
  const folded = (it) => foldable(it) && !unfolded[it.id];

  // Fragments are highlighted inside their own item (a paragraph may repeat): a note's in its color,
  // a plain fragment in the accent.
  const NAMES = /** @type {const} */ (['yellow', 'green', 'blue', 'pink', 'purple', 'frag']);
  /** @param {string} n */
  const hlName = (n) => (n === 'frag' ? 'coll-frag' : `note-${n}`);
  $effect(() => {
    const list = data?.list ?? [];
    void settings.enMode;
    void JSON.stringify(unfolded);
    tick().then(() => {
      /** @type {Record<string, Range[]>} */
      const byName = Object.fromEntries(NAMES.map((c) => [c, []]));
      for (const it of list) {
        const f = it.fragment;
        if (!f || !article || !it.ref) continue;
        const root = article.querySelector(`#cr-${it.id}`);
        const r = root && anchorRange(root, it.ref, f.lang, f.start, f.end);
        if (r) byName[it.note ? (it.note.color ?? 'yellow') : 'frag'].push(r);
      }
      for (const c of NAMES) setRanges(hlName(c), byName[c], 1);
    });
    return () => NAMES.forEach((c) => clearHighlights(hlName(c)));
  });

  /** Where a kept message was said, as a link: the paragraph's thread, the note, the chat. @param {import('../lib/api.js').CollectionItem} it */
  function messageSource(it) {
    const key = it.message?.chat ?? '';
    if (/^\d+:\d+\.\d+$/.test(key)) return { href: `/${key}`, label: `обсуждение абзаца ${key}` };
    if (key.startsWith('note:') && it.ref) return { href: `/${it.ref}`, label: `заметка к ${it.ref}` };
    if (it.ref) return { href: `/${it.ref}`, label: `к абзацу ${it.ref}` };
    if (key.startsWith('chan:') || key.startsWith('ws:')) return { href: `/chat?c=${encodeURIComponent(key)}`, label: 'из чата' };
    return null;
  }
  /** @param {import('../lib/api.js').CollectionItem} it */
  const refLabel = (it) => (it.refEnd ? `${it.ref}–${it.refEnd.split(':')[1]}` : it.ref);
  function edit() {
    collections.openId = id;
    ui.tab = 'collections';
    ui.sidebarOpen = true;
  }
</script>

<div class="reader">
  <div class="reader-scroll">
    {#if error}
      <div class="state">{error}</div>
    {:else if data}
      <div class="paper-wrap">
        <article class="paper coll-reader" bind:this={article}>
          <header class="paper-head">
            <div class="kicker">Подборка{data.authorName ? ` · ${data.authorName}` : ''} · {formatTime(data.updatedAt)}</div>
            <h1>{data.title}</h1>
            {#if data.description}<p class="coll-r-desc">{data.description}</p>{/if}
            <div class="coll-r-tools ui-chips no-print">
              <button class="ui-chip" onclick={edit}><Icon name={data.canEdit ? 'edit' : 'layers'} size={16} />{data.canEdit ? 'Изменить' : 'Состав'}</button>
              <button class="ui-chip" onclick={() => print()}>Печать</button>
              <button class="ui-chip" onclick={() => navigate(lastPath(), { root: true })}><Icon name="book-open" size={16} />К книге</button>
            </div>
            <div class="coll-r-count">{data.list.filter((x) => !(x.kind === 'text' && x.heading)).length} {plural(data.list.filter((x) => !(x.kind === 'text' && x.heading)).length, 'элемент', 'элемента', 'элементов')}</div>
          </header>
          {#each data.list as it (it.id)}
            <section class="coll-r-item" id="cr-{it.id}">
              {#if it.kind === 'text'}
                {#if it.heading}<h2 class="section-head coll-r-heading">{it.body}</h2>{:else}<p class="coll-r-text">{it.body}</p>{/if}
              {:else if it.kind === 'message' && it.message}
                <!-- a message as it was said: the quote, who and when, where it was said -->
                {@const src = messageSource(it)}
                <figure class="coll-r-msg">
                  <blockquote>{it.message.text}</blockquote>
                  <figcaption class="muted small">
                    — <b>{it.message.authorName ?? 'Участник'}</b>{#if it.message.createdAt}, {formatTime(it.message.createdAt)}{/if}
                    {#if src} · <a href={src.href} onclick={linkClick}>{src.label}</a>{/if}
                  </figcaption>
                </figure>
              {:else if folded(it)}
                <div class="coll-r-fold">
                  <a class="ref" href="/{it.ref}" onclick={linkClick} title="Открыть в книге">{it.ref}</a>
                  <span class="muted small ellipsis">{it.paragraphs?.[0]?.paperTitle ?? ''}</span>
                  <button class="ui-chip small-chip no-print" onclick={() => (unfolded[it.id] = true)}>Показать абзац</button>
                </div>
              {:else}
                {#if foldable(it)}
                  <div class="coll-r-fold no-print">
                    <span class="spacer"></span>
                    <button class="ui-chip small-chip" onclick={() => (unfolded[it.id] = false)}>Свернуть абзац</button>
                  </div>
                {/if}
                {#each it.paragraphs ?? [] as p (p.ref)}
                  <div class="pair">
                    <div class="gutter">
                      <div class="gutter-head"><a class="ref" href="/{p.ref}" onclick={linkClick} title="Открыть в книге">{p.ref}</a></div>
                      {#if settings.showPageRefs}<span class="page">{p.pageRef}</span>{/if}
                    </div>
                    <div class="texts">
                      <p class="main-text" lang={book.main} data-ref={p.ref} data-lang={book.main}>{@html inLang(p, book.main)}</p>
                      {#if book.compare}<p class="en" lang="en" data-ref={p.ref} data-lang="en">{@html p.en}</p>{/if}
                    </div>
                  </div>
                {/each}
                {#if it.kind === 'para' && it.refEnd}<div class="coll-r-source muted small">{refLabel(it)} · {it.paragraphs?.[0]?.paperTitle}</div>{/if}
              {/if}
              {#if it.kind !== 'text'}
                {#if it.fragment}
                  <blockquote class="coll-r-quote" lang={it.fragment.lang} data-color={it.note?.color ?? null}>«{it.fragment.quote}»</blockquote>
                {/if}
                {#if it.note}
                  {#if it.note.bookmark && it.note.title}<div class="coll-r-source muted small">Закладка: {it.note.title}</div>{/if}
                  {#each it.note.comments as m (m.id)}
                    <aside class="coll-r-comment"><b>{m.authorName ?? ''}</b> {m.body}</aside>
                  {/each}
                  {#if it.note.tags.length}<div class="coll-r-source muted small">{it.note.tags.map((t) => '#' + t).join(' ')}</div>{/if}
                {/if}
                {#if it.body}<aside class="coll-r-comment coll-r-own">{it.body}</aside>{/if}
              {/if}
            </section>
          {/each}
          {#if !data.list.length}
            <div class="ui-empty">
              <span class="ui-tile big"><Icon name="layers" size={22} /></span>
              <b>Подборка пуста</b>
              <p class="muted small">Добавляйте абзацы и заметки через «⋮» у абзаца или панель выделения.</p>
            </div>
          {/if}
        </article>
      </div>
    {:else}
      <div class="state">Загрузка…</div>
    {/if}
  </div>
</div>
