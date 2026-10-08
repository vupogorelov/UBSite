<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { tags, loadTags, buildTree, tagKey, tagColor, renameTag, deleteTag, setTagColor, cleanTagName } from '../lib/tags.svelte.js';
  import { api } from '../lib/api.js';
  import { showNotesForTag, setTab } from '../lib/ui.svelte.js';
  import { runSearch } from '../lib/search.svelte.js';
  import { notes } from '../lib/notes.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';
  import { can } from '../lib/session.svelte.js';

  /** @type {{ visible: boolean }} */
  let { visible } = $props();

  /** @type {'cloud' | 'tree'} */
  let view = $state('cloud');
  let topOnly = $state(false);
  let newTag = $state('');
  const expanded = new SvelteSet();
  /** Path being renamed, its new text, the path awaiting delete confirmation. */
  /** @type {string | null} */ let editing = $state(null);
  let editText = $state('');
  /** @type {string | null} */ let confirmDelete = $state(null);
  /** @type {string | null} */ let coloring = $state(null);

  $effect(() => {
    void notes.version;
    if (visible) loadTags();
  });

  const tree = $derived(buildTree(tags.list));

  const cloud = $derived.by(() => {
    const items = topOnly
      ? tree.map((n) => ({ name: n.path, count: n.total }))
      : tags.list.map((t) => ({ name: t.name, count: t.count }));
    const used = items.filter((i) => i.count > 0);
    const max = Math.max(1, ...used.map((i) => i.count));
    return used.map((i) => ({ ...i, size: 12 + 16 * Math.sqrt(i.count / max) }));
  });

  async function create() {
    const name = cleanTagName(newTag);
    if (!name) return showToast('Тег: буквы, цифры, _ и -, уровни через /');
    try {
      await api.putTag({ name });
      newTag = '';
      await loadTags(true);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }

  /** @param {string} path */
  function startRename(path) {
    editing = path;
    editText = path;
    confirmDelete = null;
  }

  /** Target exists already → the rename is a merge. */
  const mergeTarget = $derived(
    editing !== null && tagKey(editText.trim()) !== tagKey(editing) && tags.list.some((t) => tagKey(t.name) === tagKey(editText.trim())),
  );

  /** @param {SubmitEvent} e */
  async function submitRename(e) {
    e.preventDefault();
    if (editing === null) return;
    const to = cleanTagName(editText);
    if (!to) return showToast('Тег: буквы, цифры, _ и -, уровни через /');
    if (to === editing || (await renameTag(editing, to))) editing = null;
  }

  /** @param {import('../lib/tags.svelte.js').TagNode} n */
  function subtreeSize(n) {
    /** @type {(x: import('../lib/tags.svelte.js').TagNode) => number} */
    const count = (x) => (x.tag ? 1 : 0) + x.children.reduce((s, c) => s + count(c), 0);
    return count(n);
  }

  /** @param {import('../lib/tags.svelte.js').TagNode} n */
  async function remove(n) {
    if (confirmDelete !== n.path) {
      confirmDelete = n.path;
      return;
    }
    confirmDelete = null;
    await deleteTag(n.path, true);
  }

  /** @param {string} path */
  function findInText(path) {
    setTab('search');
    runSearch(`#${path}`);
  }

  /** @param {string} key */
  function toggle(key) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
  }
</script>

{#snippet row(/** @type {import('../lib/tags.svelte.js').TagNode} */ n, /** @type {number} */ depth)}
  <li>
    <div class="tag-row" style:padding-left="{depth * 14}px">
      {#if n.children.length}
        <button class="chev-btn" class:open={expanded.has(n.key)} aria-label={expanded.has(n.key) ? 'Свернуть' : 'Развернуть'}
          onclick={() => toggle(n.key)}><Icon name="chevron" /></button>
      {:else}
        <span class="chev-btn"></span>
      {/if}
      {#if editing === n.path}
        <form class="rename" onsubmit={submitRename}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="text-input" bind:value={editText} autofocus aria-label="Новое имя или путь тега"
            onkeydown={(e) => e.key === 'Escape' && (editing = null)} />
          <button class="btn primary" type="submit">{mergeTarget ? 'Объединить' : 'OK'}</button>
        </form>
      {:else}
        <button class="folder" onclick={() => showNotesForTag(n.path)} title="Заметки с тегом #{n.path}">
          <span class="dot" data-color={tagColor(n.path)}></span>
          <span class="ellipsis" class:virtual={!n.tag}>{n.segment}</span>
          <span class="count">{n.total}</span>
        </button>
        <span class="tag-actions">
          <button class="icon-btn small-btn" title="Найти в тексте" aria-label="Найти абзацы с тегом" onclick={() => findInText(n.path)}><Icon name="search" /></button>
          {#if can.own}
            <button class="icon-btn small-btn" title="Переименовать, перенести или объединить" aria-label="Переименовать" onclick={() => startRename(n.path)}><Icon name="edit" /></button>
          {/if}
          {#if can.edit}
            <button class="icon-btn small-btn" class:on={coloring === n.path} title="Цвет" aria-label="Цвет тега"
              onclick={() => (coloring = coloring === n.path ? null : n.path)}><span class="dot" data-color={n.tag?.color}></span></button>
          {/if}
          {#if can.own}
            <button class="icon-btn small-btn" class:danger={confirmDelete === n.path}
              title={confirmDelete === n.path ? `Нажмите ещё раз: удалить ${subtreeSize(n)} ${plural(subtreeSize(n), 'тег', 'тега', 'тегов')} (заметки останутся)` : 'Удалить тег'}
              aria-label="Удалить тег" onclick={() => remove(n)} onblur={() => confirmDelete === n.path && (confirmDelete = null)}><Icon name="trash" /></button>
          {/if}
        </span>
      {/if}
    </div>
    {#if coloring === n.path}
      <div class="tag-colors" style:padding-left="{depth * 14 + 24}px">
        {#each NOTE_COLORS as [c] (c)}
          <button class="swatch small" data-color={c} class:on={n.tag?.color === c} aria-label={`Цвет ${c}`}
            onclick={() => ((coloring = null), setTagColor(n.path, c))}></button>
        {/each}
        <button class="link-btn" onclick={() => ((coloring = null), setTagColor(n.path, null))}>без цвета</button>
      </div>
    {/if}
    {#if expanded.has(n.key) && n.children.length}
      <ul>{#each n.children as c (c.key)}{@render row(c, depth + 1)}{/each}</ul>
    {/if}
  </li>
{/snippet}

<div class="tags-panel">
  <!-- The view switch and its controls stay on top; the cloud or the tree scrolls. -->
  <div class="panel-head">
    <div class="segmented small-seg" role="radiogroup" aria-label="Вид">
      <button role="radio" aria-checked={view === 'cloud'} class:active={view === 'cloud'} onclick={() => (view = 'cloud')}>Облако</button>
      <button role="radio" aria-checked={view === 'tree'} class:active={view === 'tree'} onclick={() => (view = 'tree')}>Дерево и управление</button>
    </div>
    {#if view === 'cloud'}
      {#if tags.list.length}
        <label class="toggle small panel-head-last"><input type="checkbox" bind:checked={topOnly} /> только верхний уровень</label>
      {/if}
    {:else}
      {#if can.edit}
        <form class="notes-filters" onsubmit={(e) => (e.preventDefault(), create())}>
          <input class="text-input" placeholder="Новый тег: тема/подтема" bind:value={newTag} aria-label="Новый тег" />
          <button class="btn" type="submit" disabled={!newTag.trim()}>Добавить</button>
        </form>
      {/if}
      {#if can.own}
        <p class="hint panel-head-last">Переименование меняет тег во всех заметках. Путь с «/» переносит ветку
          (<code>космология</code> → <code>наука/космология</code>), имя существующего тега объединяет их.</p>
      {:else}
        <p class="hint panel-head-last">Переименовывать, объединять и удалять теги может владелец пространства.</p>
      {/if}
    {/if}
  </div>

  {#if !tags.list.length}
    <p class="muted small">Тегов пока нет. Добавьте тег к выделению кнопкой <b>#</b> на панели над текстом
      или напишите <code>#тег</code> в комментарии. Уровни разделяются косой чертой: <code>#космология/Хавона</code>.</p>
  {/if}

  {#if view === 'cloud'}
    <div class="cloud">
      {#each cloud as t (t.name)}
        <button class="cloud-tag" data-color={tagColor(t.name)} style:font-size="{t.size}px"
          title="{t.count} {plural(t.count, 'заметка', 'заметки', 'заметок')}" onclick={() => showNotesForTag(t.name)}>#{t.name}</button>
      {/each}
    </div>
  {:else}
    <ul class="folder-tree">
      {#each tree as n (n.key)}{@render row(n, 0)}{/each}
    </ul>
  {/if}
</div>
