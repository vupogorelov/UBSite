<script>
  import { onMount } from 'svelte';
  import {
    search, library, runSearch, loadMore, clearSearch, withFilter, filterValue,
    loadLibrary, saveQuery, updateQuery, deleteQuery, clearHistory,
  } from '../lib/search.svelte.js';
  import { linkClick, route, view } from '../lib/router.svelte.js';
  import { partLabel, plural } from '../lib/format.js';
  import Icon from './Icon.svelte';
  import { can } from '../lib/session.svelte.js';

  /** @type {{ onnavigate?: () => void }} */
  let { onnavigate } = $props();

  /** ☆ — saved queries (and the form to save the current one), history — recent queries only. */
  /** @type {'none' | 'help' | 'saved' | 'history' | 'save'} */
  let panel = $state('none');
  const currentSaved = $derived(library.saved.some((s) => s.query === search.input.trim()));
  let saveTitle = $state('');
  /** @type {number | null} */
  let editingId = $state(null);
  let editTitle = $state('');
  /** @type {number | null} */
  let confirmDelete = $state(null);
  /** @type {HTMLInputElement} */
  let input;
  /** @type {HTMLElement} */
  let sentinel;

  export function focus() {
    input?.focus();
    input?.select();
  }

  onMount(() => {
    loadLibrary();
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '400px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  /** @param {SubmitEvent} e */
  function submit(e) {
    e.preventDefault();
    panel = 'none';
    runSearch(search.input);
  }

  const activePart = $derived(filterValue(search.query, 'часть') ?? filterValue(search.query, 'part'));
  /** @param {string} part */
  function togglePart(part) {
    runSearch(withFilter(search.query, 'часть', activePart === part ? null : part));
  }

  /** @param {MouseEvent} e */
  function openResult(e) {
    linkClick(e);
    onnavigate?.();
  }

  function startSave() {
    saveTitle = search.input.length > 60 ? search.input.slice(0, 60) + '…' : search.input;
    panel = 'save';
  }
  /** @param {SubmitEvent} e */
  async function submitSave(e) {
    e.preventDefault();
    if (!saveTitle.trim() || !search.input.trim()) return;
    await saveQuery(saveTitle.trim(), search.input.trim());
    panel = 'saved';
  }
  /** @param {SubmitEvent} e @param {number} id */
  async function submitRename(e, id) {
    e.preventDefault();
    if (editTitle.trim()) await updateQuery(id, { title: editTitle.trim() });
    editingId = null;
  }
  /** @param {string} q */
  function useQuery(q) {
    panel = 'none';
    runSearch(q);
  }
  /** The ref shown in the reader, to mark the active result. */
  const currentRef = $derived((void view.section, void route.nav, decodeURIComponent(location.pathname).slice(1)));
</script>

<div class="search-panel">
  <!-- Query, tools, count and part filters stay on top; only the results scroll. -->
  <div class="panel-head">
  <form class="search-form" onsubmit={submit} role="search">
    <div class="search-input">
      <Icon name="search" />
      <input
        bind:this={input}
        bind:value={search.input}
        placeholder="Слова, &quot;фраза&quot;, /regex/…"
        aria-label="Поисковый запрос"
        spellcheck="false"
      />
      {#if search.input}
        <button type="button" class="icon-btn small-btn" aria-label="Очистить" onclick={() => { clearSearch(); input.focus(); }}>
          <Icon name="close" />
        </button>
      {/if}
    </div>
    <div class="search-tools">
      <button type="submit" class="btn primary">Найти</button>
      <span class="spacer"></span>
      <button type="button" class="icon-btn" class:on={panel === 'saved' || panel === 'save'} title="Сохранённые запросы пространства"
        aria-label="Сохранённые запросы" aria-expanded={panel === 'saved' || panel === 'save'}
        onclick={() => (panel = panel === 'saved' || panel === 'save' ? 'none' : 'saved')}><Icon name="star" /></button>
      <button type="button" class="icon-btn" class:on={panel === 'history'} title="История запросов" aria-label="История запросов"
        aria-expanded={panel === 'history'} onclick={() => (panel = panel === 'history' ? 'none' : 'history')}><Icon name="history" /></button>
      <button type="button" class="icon-btn" class:on={panel === 'help'} title="Синтаксис запросов" aria-label="Синтаксис запросов"
        onclick={() => (panel = panel === 'help' ? 'none' : 'help')}><Icon name="help" /></button>
    </div>
  </form>

  {#if panel === 'save'}
    <form class="search-box" onsubmit={submitSave}>
      <label class="setting-label" for="save-title">Название запроса</label>
      <input id="save-title" class="text-input" bind:value={saveTitle} />
      <div class="mono small muted wrap">{search.input}</div>
      <div class="row-end">
        <button type="button" class="btn" onclick={() => (panel = 'saved')}>Отмена</button>
        <button type="submit" class="btn primary">Сохранить</button>
      </div>
    </form>
  {:else if panel === 'saved'}
    <div class="search-box">
      <div class="lib-head">
        <div class="box-title">Сохранённые</div>
        {#if can.edit && search.input.trim()}
          {#if currentSaved}
            <span class="muted small">текущий запрос сохранён</span>
          {:else}
            <button class="btn small-btn" onclick={startSave} title={search.input}><Icon name="plus" size={14} />Сохранить текущий</button>
          {/if}
        {/if}
      </div>
      {#if !library.saved.length}
        <div class="muted small">Пока пусто.{#if can.edit} Введите запрос и нажмите «Сохранить текущий».{/if}</div>
      {/if}
      <ul class="lib-list">
        {#each library.saved as item (item.id)}
          <li>
            {#if editingId === item.id}
              <form class="rename" onsubmit={(e) => submitRename(e, item.id)}>
                <input class="text-input" bind:value={editTitle} aria-label="Новое название" />
                <button class="btn primary" type="submit">OK</button>
              </form>
            {:else}
              <button class="lib-item" onclick={() => useQuery(item.query)} title={item.query}>
                <span class="lib-title">{item.title}</span>
                <span class="mono small muted ellipsis">{item.query}</span>
              </button>
              {#if can.edit}
                <button class="icon-btn small-btn" aria-label="Переименовать" title="Переименовать"
                  onclick={() => ((editingId = item.id), (editTitle = item.title))}><Icon name="edit" /></button>
                <button class="icon-btn small-btn" class:danger={confirmDelete === item.id}
                  aria-label={confirmDelete === item.id ? 'Точно удалить?' : 'Удалить'}
                  title={confirmDelete === item.id ? 'Нажмите ещё раз для удаления' : 'Удалить'}
                  onclick={() => (confirmDelete === item.id ? deleteQuery(item.id) : (confirmDelete = item.id))}><Icon name="trash" /></button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else if panel === 'history'}
    <div class="search-box">
      <div class="box-title">История</div>
      {#if !library.recent.length}<div class="muted small">История пуста</div>{/if}
      <ul class="lib-list">
        {#each library.recent as item (item.query)}
          <li><button class="lib-item" onclick={() => useQuery(item.query)}><span class="mono small ellipsis">{item.query}</span></button></li>
        {/each}
      </ul>
      {#if library.recent.length}<button class="link-btn" onclick={clearHistory}>Очистить историю</button>{/if}
    </div>
  {:else if panel === 'help'}
    <div class="search-box help">
      <table>
        <tbody>
          <tr><td><code>любовь отца</code></td><td>все слова, в любых формах</td></tr>
          <tr><td><code>"дар отца"</code></td><td>слова подряд, в любых формах</td></tr>
          <tr><td><code>=бог</code>, <code>="дар отца"</code></td><td>точная форма слова</td></tr>
          <tr><td><code>настрой*</code></td><td>слова с этим началом</td></tr>
          <tr><td><code>-сын</code>, <code>НЕ сын</code></td><td>исключить</td></tr>
          <tr><td><code>сын | дух</code>, <code>ИЛИ</code>, <code>OR</code></td><td>любое из слов</td></tr>
          <tr><td><code>отец ~5 любовь</code>, <code>РЯДОМ/5</code></td><td>не дальше 5 слов друг от друга</td></tr>
          <tr><td><code>/вечн\w+ сын/</code></td><td>регулярное выражение (\w и \b понимают кириллицу; без учёта регистра)</td></tr>
          <tr><td><code>часть:1-2</code>, <code>текст:5,120-140</code>, <code>раздел:5:1</code></td><td>фильтры</td></tr>
          <tr><td><code>язык:ru|en|оба</code></td><td>язык для чисел и регулярных выражений</td></tr>
          <tr><td><code>#космология</code>, <code>тег:a,b</code>, <code>-#вопрос</code></td><td>абзацы с заметками под тегом (с подтемами); можно без слов</td></tr>
        </tbody>
      </table>
      <p class="small muted">Язык определяется по алфавиту слова: кириллица ищется в русском тексте, латиница — в английском.
        <code>настройщик adjuster</code> найдёт пары, где совпали обе стороны.</p>
    </div>
  {/if}

  {#if search.error}<div class="search-error" role="alert">{search.error}</div>{/if}

  {#if search.query}
    <div class="search-summary">
      <span>{search.total.toLocaleString('ru')} {plural(search.total, 'абзац', 'абзаца', 'абзацев')}</span>
    </div>
    <div class="facets">
      {#each Object.entries(search.facets) as [part, count] (part)}
        <button class="facet" class:active={activePart === part} onclick={() => togglePart(part)}
          title={activePart === part ? 'Снять фильтр' : `Только часть ${partLabel(Number(part))}`}>
          Ч.{partLabel(Number(part))} <b>{count}</b>
        </button>
      {/each}
    </div>
  {/if}
  </div>

  <ol class="results">
    {#each search.results as r (r.ref)}
      <li>
        <a href="/{r.ref}" onclick={openResult} class="result" class:active={currentRef === r.ref}>
          <div class="result-head">
            <b>{r.ref}</b>
            <span class="ellipsis">{r.paperTitle}{r.sectionTitle ? ` › ${r.sectionTitle}` : ''}</span>
          </div>
          <div class="result-ru">{#each r.ru as [t, m]}{#if m}<mark>{t}</mark>{:else}{t}{/if}{/each}</div>
          {#if r.en.some(([, m]) => m)}
            <div class="result-en" lang="en">{#each r.en as [t, m]}{#if m}<mark>{t}</mark>{:else}{t}{/if}{/each}</div>
          {/if}
        </a>
      </li>
    {/each}
  </ol>
  <div bind:this={sentinel} class="sentinel">
    {#if search.loading}<span class="muted small">Поиск…</span>{/if}
  </div>
</div>
