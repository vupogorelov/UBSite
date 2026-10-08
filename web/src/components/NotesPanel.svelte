<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from '../lib/api.js';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { notes, colorName, formatTime } from '../lib/notes.svelte.js';
  import { tags, loadTags, buildTree, inSubtree, tagKey, tagColor, NO_TAG } from '../lib/tags.svelte.js';
  import { navigate, route } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';
  import { foldingHead } from '../lib/fold.svelte.js';
  import Icon from './Icon.svelte';

  /** @type {{ visible: boolean, onnavigate?: () => void }} */
  let { visible, onnavigate } = $props();

  /** @type {import('../lib/api.js').Note[]} */
  let all = $state([]);
  let loadedVersion = -1;
  let error = $state('');

  /** @type {'all' | 'comments' | 'bookmarks'} */
  let kind = $state('all');
  const colors = new SvelteSet();
  let showResolved = $state(true);
  let text = $state('');
  /** @type {'book' | 'recent'} */
  let sort = $state('book');
  let foldersOpen = $state(true);
  const expanded = new SvelteSet();
  /** The filters fold to the count line: by hand, or while the list scrolls down. */
  const fold = foldingHead('ub.notesFiltersFolded');

  // Reload when the tab is shown and something changed since the last load.
  $effect(() => {
    const v = notes.version;
    if (!visible || v === loadedVersion) return;
    loadedVersion = v;
    loadTags();
    api.notes().then(
      (list) => ((all = list), (error = '')),
      (err) => (error = err.message),
    );
  });

  // Make the selected folder visible: expand its ancestors.
  $effect(() => {
    const f = tags.filter;
    if (!f || f === NO_TAG) return;
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    foldersOpen = true;
  });

  /** Notes after every filter except the tag folder. */
  const base = $derived.by(() => {
    const needle = text.trim().toLowerCase();
    return all.filter((n) => {
      if (kind === 'comments' && !n.comments.length) return false;
      if (kind === 'bookmarks' && !n.bookmark) return false;
      // A color belongs to bookmarks, "resolved" to comment threads: each filter to its own tab.
      if (kind === 'bookmarks' && colors.size && !(n.color && colors.has(n.color))) return false;
      if (kind !== 'bookmarks' && !showResolved && n.resolved) return false;
      if (needle) {
        const hay = [n.quote, n.title, n.ref, ...n.tags.map((t) => '#' + t), ...n.comments.map((c) => c.body)].join('\n').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  });
  const tree = $derived(buildTree(tags.list, base));
  const untagged = $derived(base.filter((n) => !n.tags.length).length);

  const filtered = $derived.by(() => {
    const f = tags.filter;
    const list =
      f === null ? base : f === NO_TAG ? base.filter((n) => !n.tags.length) : base.filter((n) => n.tags.some((t) => inSubtree(t, f)));
    return sort === 'recent' ? list.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : list;
  });

  const filterLabel = $derived(
    tags.filter === null ? null : tags.filter === NO_TAG ? 'Без тега' : '#' + (tags.list.find((t) => tagKey(t.name) === tags.filter)?.name ?? tags.filter),
  );

  /** @param {string} c */
  function toggleColor(c) {
    if (colors.has(c)) colors.delete(c);
    else colors.add(c);
  }

  /** @param {string} key */
  function selectFolder(key) {
    tags.filter = tags.filter === key ? null : key;
  }

  /** @param {string} key */
  function toggleNode(key) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
  }

  /** @param {MouseEvent} e @param {import('../lib/api.js').Note} n */
  function open(e, n) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    notes.activeId = n.id;
    navigate(`/${n.ref}`);
    onnavigate?.();
  }

  const KINDS = /** @type {const} */ ([['all', 'Все'], ['comments', 'Комментарии'], ['bookmarks', 'Закладки']]);
</script>

{#snippet folder(/** @type {import('../lib/tags.svelte.js').TagNode} */ n, /** @type {number} */ depth)}
  {#if n.total > 0 || tags.filter === n.key}
    <li>
      <div class="folder-row" style:padding-left="{depth * 14}px">
        {#if n.children.some((c) => c.total > 0)}
          <button class="chev-btn" class:open={expanded.has(n.key)} aria-label={expanded.has(n.key) ? 'Свернуть' : 'Развернуть'}
            onclick={() => toggleNode(n.key)}><Icon name="chevron" /></button>
        {:else}
          <span class="chev-btn"></span>
        {/if}
        <button class="folder" class:active={tags.filter === n.key} onclick={() => selectFolder(n.key)} title={n.path}>
          <span class="dot" data-color={tagColor(n.path)}></span>
          <span class="ellipsis">{n.segment}</span>
          <span class="count">{n.total}</span>
        </button>
      </div>
      {#if expanded.has(n.key)}
        <ul>
          {#each n.children as c (c.key)}{@render folder(c, depth + 1)}{/each}
        </ul>
      {/if}
    </li>
  {/if}
{/snippet}

<div class="notes-panel">
  <!-- Filters, tag folders and the count stay on top; only the list below scrolls. -->
  <div class="panel-head" class:folded={fold.folded} use:fold.track>
  <div class="fold-body" id="notes-filters"><div class="fold-inner">
  <div class="segmented small-seg" role="radiogroup" aria-label="Тип заметок">
    {#each KINDS as [value, label] (value)}
      <button role="radio" aria-checked={kind === value} class:active={kind === value} onclick={() => (kind = value)}>{label}</button>
    {/each}
  </div>
  <div class="notes-filters">
    {#if kind === 'bookmarks'}
      <div class="color-filter" role="group" aria-label="Цвета закладок">
        {#each NOTE_COLORS as [c] (c)}
          <button class="swatch small" data-color={c} class:on={colors.has(c)} title={colorName(c)}
            aria-label={`Цвет: ${colorName(c)}`} aria-pressed={colors.has(c)} onclick={() => toggleColor(c)}></button>
        {/each}
      </div>
    {:else}
      <label class="toggle small"><input type="checkbox" bind:checked={showResolved} /> решённые обсуждения</label>
    {/if}
  </div>
  <div class="notes-filters">
    <input class="text-input" placeholder="Фильтр по тексту и #тегам" bind:value={text} aria-label="Фильтр по тексту заметок" />
    <select class="text-input sort" bind:value={sort} aria-label="Сортировка">
      <option value="book">По книге</option>
      <option value="recent">Недавние</option>
    </select>
  </div>

  {#if tree.length || untagged}
    <div class="folders">
      <button class="box-title folders-toggle" onclick={() => (foldersOpen = !foldersOpen)} aria-expanded={foldersOpen}>
        <span class="chev" class:open={foldersOpen}><Icon name="chevron" /></span> Теги
      </button>
      {#if foldersOpen}
        <ul class="folder-tree">
          {#each tree as n (n.key)}{@render folder(n, 0)}{/each}
          {#if untagged}
            <li>
              <div class="folder-row">
                <span class="chev-btn"></span>
                <button class="folder muted" class:active={tags.filter === NO_TAG} onclick={() => selectFolder(NO_TAG)}>
                  <span class="ellipsis">Без тега</span><span class="count">{untagged}</span>
                </button>
              </div>
            </li>
          {/if}
        </ul>
      {/if}
    </div>
  {/if}

  </div></div>

  {#if error}<div class="search-error">{error}</div>{/if}
  <div class="search-summary fold-summary">
    {filtered.length} {plural(filtered.length, 'заметка', 'заметки', 'заметок')}
    {#if filterLabel}
      <button class="facet active" onclick={() => (tags.filter = null)} title="Показать все">{filterLabel} ×</button>
    {/if}
    <span class="spacer"></span>
    <button class="icon-btn small-btn fold-btn" onclick={fold.toggle} aria-expanded={!fold.folded} aria-controls="notes-filters"
      title={fold.folded ? 'Показать фильтры' : 'Свернуть фильтры'} aria-label={fold.folded ? 'Показать фильтры' : 'Свернуть фильтры'}>
      <Icon name={fold.folded ? 'down' : 'up'} size={16} />
    </button>
  </div>
  </div>

  {#if !all.length && !error}
    <p class="muted small">Выделите текст в читалке — появится панель с закладкой (название и цвет), комментарием и тегами.
      Действия для всего абзаца — кнопка ⋯ у номера абзаца.</p>
  {/if}

  <ol class="results">
    {#each filtered as n (n.id)}
      <li>
        <a href="/{n.ref}" class="result note-item" class:active={notes.activeId === n.id && route.ref === n.ref}
          data-color={n.color} onclick={(e) => open(e, n)}>
          <div class="result-head">
            <b>{n.ref}</b>
            <span class="ellipsis">{n.paperTitle ?? 'абзац не найден'}</span>
            <span class="spacer"></span>
            {#if n.bookmark}<span class="gmark gmark-bookmark" title="Закладка"><Icon name="bookmark" size={13} /></span>{/if}
            {#if n.comments.length}<span class="gmark" title="Комментарии"><Icon name="comment" size={13} />{n.comments.length}</span>{/if}
            {#if n.resolved}<span class="note-resolved">Решено</span>{/if}
          </div>
          {#if n.bookmark && n.title}<div class="note-title">{n.title}</div>{/if}
          <div class="result-ru note-quote-line" lang={n.lang ?? 'ru'}>{n.quote ?? 'Весь абзац'}</div>
          {#if n.comments.length}
            <div class="note-comment-line">{n.comments[0].body}</div>
          {/if}
          {#if n.tags.length}
            <div class="note-tags">{#each n.tags as t (t)}<span class="tag-chip small" data-color={tagColor(t)}>#{t}</span>{/each}</div>
          {/if}
          <div class="note-date">
            {#if n.color}<span class="dot" data-color={n.color}></span>{colorName(n.color)} · {/if}{formatTime(n.updatedAt)}
          </div>
        </a>
      </li>
    {/each}
  </ol>
</div>
