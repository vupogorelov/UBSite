<script>
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { collections } from '../lib/collections.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { linkClick, navigate, lastPath } from '../lib/router.svelte.js';
  import { anchorRange, setRanges, clearHighlights } from '../lib/highlight.js';
  import { formatTime } from '../lib/notes.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * A collection read as one text: its items in order — section titles, the compiler's notes,
   * paragraphs with their comments — each linking back to its place in the book.
   * @type {{ id: number }}
   */
  let { id } = $props();

  /** @type {import('../lib/api.js').CollectionFull | null} */
  let data = $state(null);
  let error = $state('');
  /** @type {HTMLElement | undefined} */ let article = $state();

  $effect(() => {
    void collections.version;
    api.collection(id).then(
      (c) => ((data = c), (error = ''), (document.title = `${c.title} — Urantian Docs Explorer`)),
      (err) => ((data = null), (error = err.message)),
    );
    return () => (document.title = 'Urantian Docs Explorer');
  });

  // Quotes of notes are highlighted in their color (inside their own item: a paragraph may repeat).
  const COLORS = /** @type {const} */ (['yellow', 'green', 'blue', 'pink', 'purple']);
  $effect(() => {
    const list = data?.list ?? [];
    void settings.enMode;
    tick().then(() => {
      /** @type {Record<string, Range[]>} */
      const byColor = Object.fromEntries(COLORS.map((c) => [c, []]));
      for (const it of list) {
        const n = it.note;
        if (!n || n.lang === null || n.start === null || n.end === null || !article) continue;
        const root = article.querySelector(`#cr-${it.id}`);
        const r = root && anchorRange(root, n.ref, n.lang, n.start, n.end);
        if (r) byColor[n.color ?? 'yellow'].push(r);
      }
      for (const c of COLORS) setRanges(`note-${c}`, byColor[c], 1);
    });
    return () => COLORS.forEach((c) => clearHighlights(`note-${c}`));
  });

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
            <div class="coll-r-tools no-print">
              <button class="btn" onclick={edit}><Icon name="layers" size={16} />{data.canEdit ? 'Изменить' : 'В боковой панели'}</button>
              <button class="btn" onclick={() => print()}>Печать</button>
              <button class="btn" onclick={() => navigate(lastPath())}>Вернуться к книге</button>
            </div>
          </header>
          {#each data.list as it (it.id)}
            <section class="coll-r-item" id="cr-{it.id}">
              {#if it.kind === 'text'}
                {#if it.heading}<h2 class="section-head coll-r-heading">{it.body}</h2>{:else}<p class="coll-r-text">{it.body}</p>{/if}
              {:else}
                {#each it.paragraphs ?? [] as p (p.ref)}
                  <div class="pair">
                    <div class="gutter">
                      <div class="gutter-head"><a class="ref" href="/{p.ref}" onclick={linkClick} title="Открыть в книге">{p.ref}</a></div>
                      {#if settings.showPageRefs}<span class="page">{p.pageRef}</span>{/if}
                    </div>
                    <div class="texts">
                      <p class="ru" data-ref={p.ref} data-lang="ru">{@html p.ru}</p>
                      {#if settings.enMode !== 'hidden'}<p class="en" lang="en" data-ref={p.ref} data-lang="en">{@html p.en}</p>{/if}
                    </div>
                  </div>
                {/each}
                {#if it.kind === 'para' && it.refEnd}<div class="coll-r-source muted small">{refLabel(it)} · {it.paragraphs?.[0]?.paperTitle}</div>{/if}
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
          {#if !data.list.length}<p class="muted">Подборка пуста.</p>{/if}
        </article>
      </div>
    {:else}
      <div class="state">Загрузка…</div>
    {/if}
  </div>
</div>
