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
  <form class="group glossary-form" onsubmit={(e) => (e.preventDefault(), save())}>
    <label class="setting-label" for="g-en">Термин в оригинале</label>
    <input id="g-en" class="text-input" bind:value={form.en} placeholder="Thought Adjuster" lang="en" />
    <label class="setting-label" for="g-ru">Обязательный перевод</label>
    <input id="g-ru" class="text-input" bind:value={form.ru} placeholder="Настройщик Мысли" />
    <label class="setting-label" for="g-avoid">Нежелательные варианты <span class="muted">— по одному в строке</span></label>
    <textarea id="g-avoid" class="text-area" bind:value={form.avoid} rows="2" placeholder="Регулятор Мысли"></textarea>
    <label class="setting-label" for="g-note">Пояснение</label>
    <textarea id="g-note" class="text-area" bind:value={form.note} rows="2" placeholder="Почему так (необязательно)"></textarea>
    <div class="row-end">
      <button type="button" class="btn" onclick={() => (editing = null)}>Отмена</button>
      <button class="btn primary" disabled={!form.en.trim() || !form.ru.trim()}>Сохранить</button>
    </div>
  </form>
{/snippet}

<div class="glossary-head">
  <div class="notes-filters">
    <input class="text-input" bind:value={filter} placeholder="Найти термин (EN или RU)" aria-label="Найти термин" />
    {#if coordinator}
      <button class="btn" onclick={() => edit(null)} disabled={editing === 'new'}>Добавить</button>
    {/if}
  </div>
  <div class="search-summary">
    {shown.length} {plural(shown.length, 'термин', 'термина', 'терминов')}
    {#if !coordinator}<span class="muted"> · глоссарий ведут координаторы</span>{/if}
  </div>
</div>
{#if editing === 'new'}{@render editor()}{/if}
{#if !terms.length && editing !== 'new'}
  <p class="muted small">
    Глоссарий пуст. Здесь будут обязательные переводы терминов книги: при написании варианта перевода
    система подскажет термины и предупредит, если обязательный перевод пропал или использован нежелательный.
  </p>
{/if}
<ol class="results glossary-list">
  {#each shown as t (t.id)}
    <li>
      {#if editing === t.id}
        {@render editor()}
      {:else}
        <div class="result glossary-term">
          <div class="result-head">
            <b lang="en">{t.en}</b>
            <span class="muted">→</span>
            <b class="glossary-ru">{t.ru}</b>
            <span class="spacer"></span>
            {#if coordinator}
              <button class="icon-btn small-btn" aria-label="Изменить термин" onclick={() => edit(t)}><Icon name="edit" /></button>
              <button class="icon-btn small-btn" class:danger={confirmDelete === t.id} onblur={() => (confirmDelete = null)}
                aria-label="Удалить термин" title={confirmDelete === t.id ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить'}
                onclick={() => remove(t.id)}><Icon name="trash" /></button>
            {/if}
          </div>
          {#if t.avoid.length}<div class="small">не: {#each t.avoid as a, i (a)}{i ? ', ' : ''}<del>{a}</del>{/each}</div>{/if}
          {#if t.note}<div class="muted small">{t.note}</div>{/if}
        </div>
      {/if}
    </li>
  {/each}
</ol>
