<script>
  import { api } from '../lib/api.js';
  import { session } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /** @type {{ visible: boolean }} */
  let { visible } = $props();

  /** @type {import('../lib/api.js').GlossaryTerm[]} */
  let terms = $state([]);
  let loaded = false;
  let filter = $state('');
  /** The term being edited: an id, 'new', or null. @type {number | 'new' | null} */
  let editing = $state(null);
  let form = $state({ en: '', ru: '', avoid: '', note: '' });
  let confirmDelete = $state(/** @type {number | null} */ (null));

  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  const shown = $derived.by(() => {
    const f = filter.trim().toLowerCase().replace(/ё/g, 'е');
    if (!f) return terms;
    const has = (/** @type {string} */ s) => s.toLowerCase().replace(/ё/g, 'е').includes(f);
    return terms.filter((t) => has(t.en) || has(t.ru) || t.avoid.some(has) || (t.note !== null && has(t.note)));
  });

  async function load() {
    try {
      terms = await api.glossary();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
  $effect(() => {
    if (visible && !loaded) {
      loaded = true;
      void load();
    }
  });

  /** @param {import('../lib/api.js').GlossaryTerm | null} t */
  function edit(t) {
    editing = t ? t.id : 'new';
    form = t ? { en: t.en, ru: t.ru, avoid: t.avoid.join('\n'), note: t.note ?? '' } : { en: filter.trim(), ru: '', avoid: '', note: '' };
  }

  async function save() {
    const term = { en: form.en, ru: form.ru, avoid: form.avoid.split('\n'), note: form.note.trim() || null };
    try {
      if (editing === 'new') await api.createTerm(term);
      else if (editing !== null) await api.updateTerm(editing, term);
      editing = null;
      await load();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }

  /** @param {number} id */
  async function remove(id) {
    if (confirmDelete !== id) {
      confirmDelete = id;
      return;
    }
    try {
      await api.deleteTerm(id);
      confirmDelete = null;
      await load();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
</script>

{#snippet editor()}
  <!-- a term: a card with its four fields, «Отмена» and «Сохранить» -->
  <form class="ui-card gl-form" onsubmit={(e) => (e.preventDefault(), save())}>
    <b class="gl-form-title">{editing === 'new' ? 'Новый термин' : 'Термин'}</b>
    <label class="gl-field"><span>Термин в оригинале</span>
      <input class="ui-input" bind:value={form.en} placeholder="Thought Adjuster" lang="en" /></label>
    <label class="gl-field"><span>Обязательный перевод</span>
      <input class="ui-input" bind:value={form.ru} placeholder="Настройщик Мысли" /></label>
    <label class="gl-field"><span>Нежелательные варианты — по одному в строке</span>
      <textarea class="ui-input gl-area" bind:value={form.avoid} rows="2" placeholder="Регулятор Мысли"></textarea></label>
    <label class="gl-field"><span>Пояснение</span>
      <textarea class="ui-input gl-area" bind:value={form.note} rows="2" placeholder="Почему так (необязательно)"></textarea></label>
    <div class="gl-actions">
      <button type="button" class="ui-btn" onclick={() => (editing = null)}>Отмена</button>
      <button class="ui-btn primary" disabled={!form.en.trim() || !form.ru.trim()}>Сохранить</button>
    </div>
  </form>
{/snippet}

<div class="glossary-head">
  <div class="ui-search-row">
    <label class="ui-search">
      <Icon name="search" size={18} />
      <input bind:value={filter} placeholder="Найти термин (EN или RU)" aria-label="Найти термин" />
      {#if filter}<button class="ui-search-clear" onclick={(e) => (e.preventDefault(), (filter = ''))} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
    </label>
    {#if coordinator}
      <button class="ui-round primary" onclick={() => edit(null)} disabled={editing === 'new'} aria-label="Добавить термин" title="Добавить термин"><Icon name="plus" /></button>
    {/if}
  </div>
  <div class="ui-label gl-count">
    {shown.length} {plural(shown.length, 'термин', 'термина', 'терминов')}{#if !coordinator} · глоссарий ведут координаторы{/if}
  </div>
</div>
{#if editing === 'new'}{@render editor()}{/if}
{#if !terms.length && editing !== 'new'}
  <div class="ui-empty">
    <span class="ui-tile big"><Icon name="book-open" size={22} /></span>
    <b>Глоссарий пуст</b>
    <p class="muted small">Здесь будут обязательные переводы терминов книги: при написании варианта перевода
      система подскажет термины и предупредит, если обязательный перевод пропал или использован нежелательный.</p>
  </div>
{/if}
<ol class="ui-cards gl-list">
  {#each shown as t (t.id)}
    <li>
      {#if editing === t.id}
        {@render editor()}
      {:else}
        <div class="ui-card gl-term">
          <span class="ui-card-body">
            <span class="ui-card-title gl-ru">{t.ru}</span>
            <span class="ui-card-meta gl-en" lang="en">{t.en}</span>
            {#if t.avoid.length}<span class="gl-avoid">не: {#each t.avoid as a, i (a)}{i ? ', ' : ''}<del>{a}</del>{/each}</span>{/if}
            {#if t.note}<span class="ui-card-text">{t.note}</span>{/if}
          </span>
          {#if coordinator}
            <span class="gl-tools">
              <button class="ui-round small plain" aria-label="Изменить термин" title="Изменить" onclick={() => edit(t)}><Icon name="edit" size={16} /></button>
              <button class="ui-round small plain" class:danger={confirmDelete === t.id} onblur={() => (confirmDelete = null)}
                aria-label="Удалить термин" title={confirmDelete === t.id ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить'}
                onclick={() => remove(t.id)}><Icon name="trash" size={16} /></button>
            </span>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ol>
