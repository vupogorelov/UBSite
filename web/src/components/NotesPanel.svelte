<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { feedReady } from '../lib/feed.js';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { notes, colorName, formatTime, allNotes } from '../lib/notes.svelte.js';
  import { tags, loadTags, buildTree, inSubtree, tagKey, tagColor, NO_TAG } from '../lib/tags.svelte.js';
  import { navigate, route } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';
  import { foldingHead } from '../lib/fold.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import { notesUi } from '../lib/notesui.svelte.js';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';

  /** @type {{ visible: boolean, onnavigate?: () => void }} */
  let { visible, onnavigate } = $props();

  /** @type {import('../lib/api.js').Note[]} */
  let all = $state([]);
  let loadedVersion = -1;
  let error = $state('');

  let kind = $state(/** @type {'all' | 'comments' | 'bookmarks'} */ ('all'));
  const colors = new SvelteSet();
  let showResolved = $state(true);
  let text = $state('');
  /** @type {'book' | 'recent'} */
  let sort = $state('book');
  const expanded = new SvelteSet();
  /** The computer's panel: the filters fold under the search (the filter button). */
  const fold = foldingHead('ub.notesFiltersFolded');

  // Reload when the tab is shown and something changed since the last load.
  $effect(() => {
    const v = notes.version;
    if (!visible || v === loadedVersion) return;
    loadedVersion = v;
    loadTags();
    // (the workspace's notes kept on the device — the feed — with what still waits to be sent)
    feedReady().then(() => ((all = allNotes()), (error = '')));
  });

  // Make the selected folder visible: expand its ancestors.
  $effect(() => {
    const f = tags.filter;
    if (!f || f === NO_TAG) return;
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
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
  const SORTS = /** @type {const} */ ([['book', 'По книге', 'В порядке текста'], ['recent', 'Недавние', 'Сначала изменённые последними']]);

  /** Filters set away from their defaults (the count on the filter buttons). */
  const filtersOn = $derived((sort !== 'book' ? 1 : 0) + (kind === 'bookmarks' ? colors.size : showResolved ? 0 : 1) + (tags.filter !== null ? 1 : 0));
  function resetFilters() {
    sort = 'book';
    colors.clear();
    showResolved = true;
    tags.filter = null;
  }
  // The phone's filters sheet closes on "back", as every sheet.
  $effect(() => {
    if (notesUi.filters) return onBack(() => void (notesUi.filters = false));
  });
  $effect(() => {
    if (!visible) notesUi.filters = false;
  });

  /** The note's tile: its bookmark's color, or what it is. @param {import('../lib/api.js').Note} n */
  const tileIcon = (n) => (n.bookmark ? 'bookmark' : n.comments.length ? 'comment' : 'notes');
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

{#snippet filtersBody()}
  <!-- sort, the kind's own filter, tags: the same body in the computer's panel and the phone's sheet -->
  <div class="ui-label">Сортировка</div>
  <div class="ui-options" role="radiogroup" aria-label="Сортировка">
    {#each SORTS as [value, label, hint] (value)}
      <button class="ui-option" role="radio" aria-checked={sort === value} class:on={sort === value} onclick={() => (sort = value)}>
        <span><b>{label}</b><span class="muted small">{hint}</span></span><span class="ui-radio"></span>
      </button>
    {/each}
  </div>
  {#if kind === 'bookmarks'}
    <div class="ui-label">Цвета закладок</div>
    <div class="color-filter" role="group" aria-label="Цвета закладок">
      {#each NOTE_COLORS as [c] (c)}
        <button class="swatch" data-color={c} class:on={colors.has(c)} title={colorName(c)}
          aria-label={`Цвет: ${colorName(c)}`} aria-pressed={colors.has(c)} onclick={() => toggleColor(c)}></button>
      {/each}
    </div>
  {:else}
    <label class="ui-option ui-switch-row">
      <span><b>Решённые обсуждения</b><span class="muted small">Показывать закрытые ветки</span></span>
      <input type="checkbox" class="ui-switch" bind:checked={showResolved} />
    </label>
  {/if}
  {#if tree.length || untagged}
    <div class="ui-label">Теги</div>
    <ul class="folder-tree ui-tree">
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
{/snippet}

<div class="notes-panel">
  <!-- The search, the kind and the count stay on top; only the list below scrolls. -->
  <div class="panel-head" class:folded={fold.folded}>
    <div class="ui-search-row">
      <label class="ui-search">
        <Icon name="search" size={18} />
        <input placeholder="Поиск по заметкам и #тегам" bind:value={text} aria-label="Поиск по заметкам" />
        {#if text}<button class="ui-search-clear" onclick={() => (text = '')} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
      </label>
      <!-- "Все ⌄": what kind of notes -->
      <UiSelect variant="inline" title="Какие заметки" value={kind} onchange={(x) => (kind = /** @type {any} */ (x))}
        options={[{ value: 'all', label: 'Все', hint: 'Закладки и комментарии' }, { value: 'comments', label: 'Комментарии', hint: 'Заметки с обсуждением' }, { value: 'bookmarks', label: 'Закладки', hint: 'Отмеченные места' }]} />
      {#if !device.mobile}
        <button class="ui-round" class:on={!fold.folded || filtersOn} onclick={fold.toggle} aria-expanded={!fold.folded} aria-controls="notes-filters"
          title="Фильтры" aria-label="Фильтры"><Icon name="settings" size={18} />{#if filtersOn}<span class="ui-dot"></span>{/if}</button>
      {/if}
    </div>
    {#if !device.mobile}
      <div class="fold-body" id="notes-filters"><div class="fold-inner">{@render filtersBody()}</div></div>
    {/if}

    {#if error}<div class="search-error">{error}</div>{/if}
    <div class="search-summary fold-summary ui-count">
      {filtered.length} {plural(filtered.length, 'заметка', 'заметки', 'заметок')}
      {#if filterLabel}
        <button class="ui-chip on" onclick={() => (tags.filter = null)} title="Показать все">{filterLabel} <Icon name="close" size={12} /></button>
      {/if}
    </div>
  </div>

  {#if !all.length && !error}
    <div class="ui-empty">
      <span class="ui-tile big"><Icon name="notes" size={22} /></span>
      <b>Заметок пока нет</b>
      <p class="muted small">Выделите текст в читалке — появится панель с закладкой, комментарием и тегами.
        Для всего абзаца — кнопка ⋮ у его номера.</p>
    </div>
  {/if}

  <ol class="results ui-cards">
    {#each filtered as n (n.id)}
      <li>
        <a href="/{n.ref}" class="ui-card note-card-item" class:active={notes.activeId === n.id && route.ref === n.ref} onclick={(e) => open(e, n)}>
          <span class="ui-tile" data-color={n.bookmark ? n.color : null}><Icon name={tileIcon(n)} size={18} /></span>
          <span class="ui-card-body">
            <span class="ui-card-title" lang={n.bookmark && n.title ? 'ru' : n.lang ?? 'ru'}>{n.bookmark && n.title ? n.title : n.quote ?? 'Весь абзац'}</span>
            <span class="ui-card-meta"><b>{n.ref}</b> · {n.paperTitle ?? 'абзац не найден'}</span>
            {#if n.bookmark && n.title && n.quote}<span class="ui-card-quote" lang={n.lang ?? 'ru'}>{n.quote}</span>{/if}
            {#if n.comments.length}<span class="ui-card-text">{n.comments[0].body}</span>{/if}
            {#if n.tags.length}
              <span class="ui-card-tags">{#each n.tags as t (t)}<span class="ui-chip small">#{t}</span>{/each}</span>
            {/if}
            <span class="ui-card-foot">
              {#if n.color}<span class="dot" data-color={n.color}></span>{colorName(n.color)} ·{/if}
              <span>{formatTime(n.updatedAt)}</span>
              {#if n.comments.length}<span class="ui-card-count"><Icon name="comment" size={13} />{n.comments.length}</span>{/if}
              {#if n.resolved}<span class="ui-status">Решено</span>{/if}
            </span>
          </span>
        </a>
      </li>
    {/each}
  </ol>
</div>

{#if device.mobile && notesUi.filters}
  <button class="sheet-scrim" aria-label="Закрыть фильтры" onclick={() => (notesUi.filters = false)}></button>
  <div class="sheet ui-sheet" role="dialog" aria-label="Фильтры заметок" use:swipeClose={{ dirs: ['down'], onclose: () => (notesUi.filters = false) }}>
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="ui-sheet-head">
      <button class="ui-round plain" onclick={() => (notesUi.filters = false)} aria-label="Закрыть"><Icon name="close" /></button>
      <b>Фильтры</b>
      <button class="link-btn ui-sheet-action" onclick={resetFilters} disabled={!filtersOn}>Сбросить</button>
    </div>
    {@render filtersBody()}
    <button class="ui-btn primary" onclick={() => (notesUi.filters = false)}>Показать {filtered.length} {plural(filtered.length, 'заметку', 'заметки', 'заметок')}</button>
  </div>
{/if}
