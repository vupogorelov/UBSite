<script>
  import { onMount } from 'svelte';
  import { navigate, route } from '../../lib/router.svelte.js';
  import { session } from '../../lib/session.svelte.js';
  import { book } from '../../lib/lang.svelte.js';
  import { plural } from '../../lib/format.js';
  import { showToast } from '../../lib/toast.svelte.js';
  import { dictApi, KINDS, kindName } from './api.js';
  import { shown as fromCopy } from '../../lib/api.js';
  import Icon from '../../components/Icon.svelte';

  /**
   * «Словарь» (/d): the book's articles — found by a name or a word of what they say, by kind. A
   * coordinator sees the drafts too, and «Заготовки»: the glossary's names no article has yet, the most
   * named first — an article is begun from one in a tap.
   */

  const coordinator = $derived(!!session.user && (session.user.isCoordinator || session.user.isAdmin));
  let items = $state(/** @type {import('./api.js').ArticleItem[] | null} */ (null));
  let candidates = $state(/** @type {import('./api.js').Candidate[] | null} */ (null));
  let error = $state('');
  let query = $state(new URLSearchParams(route.path.split('?')[1] ?? '').get('q') ?? '');
  let kind = $state(/** @type {import('./api.js').Kind | ''} */ (''));
  let tab = $state(/** @type {'articles' | 'candidates'} */ ('articles'));

  onMount(() => {
    fromCopy(dictApi.list(coordinator), (r) => (items = r)).catch((e) => (error = e.message));
  });
  $effect(() => {
    if (coordinator && candidates === null) dictApi.candidates().then((r) => (candidates = r), () => (candidates = []));
  });

  const low = (/** @type {string} */ s) => s.toLocaleLowerCase('ru');
  const shown = $derived(
    (items ?? []).filter((a) => (!kind || a.kind === kind) && (!query.trim() || [a.nameRu, a.nameEn, a.briefRu, a.briefEn].some((x) => low(x).includes(low(query.trim()))))),
  );
  const shownCandidates = $derived((candidates ?? []).filter((c) => !query.trim() || [c.ru, c.en].some((x) => low(x).includes(low(query.trim())))));
  const name = (/** @type {{ nameRu: string, nameEn: string }} */ a) => (book.main === 'en' && a.nameEn ? a.nameEn : a.nameRu);
  const brief = (/** @type {{ briefRu: string, briefEn: string }} */ a) => (book.main === 'en' && a.briefEn ? a.briefEn : a.briefRu);

  /** An article begun from a name of the glossary. @param {import('./api.js').Candidate} c */
  async function begin(c) {
    try {
      const { id } = await dictApi.create({ nameRu: c.ru, nameEn: c.en, glossaryIds: [c.id] });
      navigate(`/d/${id}?edit=1`);
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }
  /** An article with no name of the glossary (an idea, a concept the glossary does not hold). */
  async function beginBlank() {
    const nameRu = query.trim();
    if (!nameRu) return showToast('Напишите название статьи в поле поиска');
    try {
      const { id } = await dictApi.create({ nameRu });
      navigate(`/d/${id}?edit=1`);
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }
</script>

<div class="dict-page">
  <div class="dict-inner">
    <h1 class="dict-h">Словарь книги</h1>
    <p class="muted dict-lead">Личности, существа, места, понятия и события книги — кратко и с местами в тексте.</p>

    <div class="ui-search">
      <Icon name="search" size={18} />
      <input bind:value={query} placeholder="Имя или слово" aria-label="Поиск по словарю" autocomplete="off" />
      {#if query}<button class="ui-search-clear" aria-label="Очистить" onclick={() => (query = '')}><Icon name="close" size={16} /></button>{/if}
    </div>

    {#if coordinator}
      <div class="ui-chips dict-tabs" role="tablist">
        <button class="ui-chip" class:on={tab === 'articles'} role="tab" aria-selected={tab === 'articles'} onclick={() => (tab = 'articles')}>Статьи</button>
        <button class="ui-chip" class:on={tab === 'candidates'} role="tab" aria-selected={tab === 'candidates'} onclick={() => (tab = 'candidates')}>
          Заготовки{#if candidates?.length}<span class="dict-n">{candidates.length}</span>{/if}</button>
      </div>
    {/if}

    {#if tab === 'articles'}
      <div class="ui-chips dict-kinds" role="radiogroup" aria-label="Вид">
        <button class="ui-chip" class:on={!kind} role="radio" aria-checked={!kind} onclick={() => (kind = '')}>Все</button>
        {#each KINDS as [k, , many] (k)}
          <button class="ui-chip" class:on={kind === k} role="radio" aria-checked={kind === k} onclick={() => (kind = kind === k ? '' : k)}>{many}</button>
        {/each}
      </div>
      {#if error}
        <p class="muted">{error}</p>
      {:else if items === null}
        <p class="muted">Загрузка…</p>
      {:else if !shown.length}
        <div class="ui-empty">
          <b>{items.length ? 'Ничего не найдено' : 'Словарь пока пуст'}</b>
          <p class="muted">{coordinator ? (items.length ? 'Можно начать статью с этим названием.' : 'Начните с «Заготовок»: имена из глоссария, самые частые — первыми.') : 'Статьи появятся, когда координаторы их напишут.'}</p>
          {#if coordinator && query.trim()}<button class="ui-btn" onclick={beginBlank}><Icon name="plus" size={16} />Статья «{query.trim()}»</button>{/if}
        </div>
      {:else}
        <ul class="ui-cards dict-list">
          {#each shown as a (a.id)}
            <li>
              <a class="ui-card dict-item" href="/d/{a.id}" onclick={(e) => (e.preventDefault(), navigate(`/d/${a.id}`))}>
                <span class="dict-item-text">
                  <span class="dict-item-head">
                    <b>{name(a)}</b>
                    {#if a.nameEn && book.main !== 'en'}<span class="muted" lang="en">{a.nameEn}</span>{/if}
                    {#if a.status === 'draft'}<span class="dict-draft">черновик</span>{/if}
                  </span>
                  {#if brief(a)}<span class="dict-item-brief">{brief(a)}</span>{/if}
                  <span class="muted small">{kindName(a.kind)}{a.paragraphs ? ` · ${a.paragraphs} ${plural(a.paragraphs, 'абзац', 'абзаца', 'абзацев')}` : ''}</span>
                </span>
                <Icon name="chevron" size={16} />
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="ui-hint">Имена из глоссария, о которых статьи ещё нет. Самые частые в книге — первыми.</p>
      {#if candidates === null}
        <p class="muted">Загрузка…</p>
      {:else}
        <ul class="set-list dict-candidates">
          {#each shownCandidates.slice(0, 200) as c (c.id)}
            <li class="set-row set-row-static">
              <span class="set-row-text">
                <b>{c.ru}</b>
                <span class="muted small">{c.en} · {c.paragraphs} {plural(c.paragraphs, 'абзац', 'абзаца', 'абзацев')}</span>
              </span>
              <button class="ui-btn small dict-begin" onclick={() => begin(c)}><Icon name="plus" size={15} />Статья</button>
            </li>
          {:else}
            <li class="set-row set-row-static"><span class="muted">Нет заготовок{query ? ' по этому слову' : ''}.</span></li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

<style>
  .dict-page {
    height: 100%;
    overflow: auto;
    background: var(--bg);
  }
  .dict-inner {
    display: grid;
    gap: var(--space-3);
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-16);
  }
  .dict-h {
    margin: 0;
    font: 600 26px/32px var(--sans);
  }
  .dict-lead {
    margin: 0 0 var(--space-2);
  }
  .dict-n {
    margin-left: 6px;
    color: var(--muted);
  }
  .dict-list {
    margin-top: var(--space-1);
  }
  .dict-item {
    align-items: center;
  }
  .dict-item-text {
    display: grid;
    flex: 1;
    gap: 4px;
    min-width: 0;
  }
  .dict-item-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px var(--space-2);
  }
  .dict-item-head b {
    font: 600 16px/22px var(--sans);
  }
  .dict-item-brief {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    font: 14px/20px var(--sans);
  }
  .dict-draft {
    padding: 0 8px;
    border-radius: 10px;
    background: var(--ui-fill);
    color: var(--muted);
    font: 500 12px/20px var(--sans);
  }
  .dict-begin {
    width: auto;
    flex: none;
    white-space: nowrap;
  }
  @media (max-width: 767px) {
    .dict-inner {
      padding: var(--space-4) calc(var(--space-4) + var(--safe-right)) calc(var(--m-nav) + var(--safe-bottom) + var(--space-8)) calc(var(--space-4) + var(--safe-left));
    }
    .dict-h {
      display: none; /* (the phone's header names the page) */
    }
  }
</style>
