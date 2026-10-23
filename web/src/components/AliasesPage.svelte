<script>
  import { aliases, loadAliases, addAlias, updateAlias, deleteAlias } from '../lib/aliases.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import Icon from './Icon.svelte';
  import InfoTip from './InfoTip.svelte';

  /**
   * Настройки → Словарь названий: names the translation transliterates and their renderings by
   * meaning, shown in their place when "Названия по смыслу" (Настройки → Текст) is on. Everybody reads, coordinators edit.
   * A word form that does not follow the name's endings is written as a line "форма = замена".
   */
  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  $effect(() => void loadAliases());

  /** @typedef {import('../lib/api.js').NameAlias} NameAlias */
  const empty = () => ({ written: '', alias: '', note: '', forms: '' });
  let draft = $state(empty());
  let editing = $state(/** @type {number | null} */ (null));
  let edit = $state(empty());
  let confirmDelete = $state(/** @type {number | null} */ (null));

  /** @param {Record<string, string>} f */
  const formsText = (f) => Object.entries(f).map(([k, v]) => `${k} = ${v}`).join('\n');
  /** @param {string} s */
  const parseForms = (s) =>
    Object.fromEntries(s.split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]));
  /** @param {ReturnType<typeof empty>} d @param {string | null} source */
  const entry = (d, source) => ({ written: d.written.trim(), alias: d.alias.trim(), note: d.note.trim() || null, forms: parseForms(d.forms), source });

  /** @param {SubmitEvent} e */
  async function add(e) {
    e.preventDefault();
    if (await addAlias(entry(draft, null))) draft = empty();
  }
  /** @param {NameAlias} a */
  function startEdit(a) {
    editing = a.id;
    edit = { written: a.written, alias: a.alias, note: a.note ?? '', forms: formsText(a.forms) };
  }
  /** @param {SubmitEvent} e @param {NameAlias} a */
  async function save(e, a) {
    e.preventDefault();
    if (await updateAlias(a.id, entry(edit, a.source))) editing = null;
  }
</script>

<div class="aliases-page">
  <section class="voice-dict">
    <!-- (how it works: in ⓘ, not as text) -->
    <div class="set-section">Словарь названий<InfoTip text="Окончание переносится: «Салвингтона» → «Спасограда». Формы, которые склоняются иначе, — строками «Декаполиса = Десятиградия»." /></div>
    {#if coordinator}
      <form class="voice-add voice-add-card" onsubmit={add}>
        <input class="ui-input" bind:value={draft.written} placeholder="Как в переводе" aria-label="Как в переводе" />
        <input class="ui-input" bind:value={draft.alias} placeholder="Как показывать" aria-label="Как показывать" />
        <input class="ui-input" bind:value={draft.note} placeholder="Пояснение (необязательно)" aria-label="Пояснение" />
        <textarea class="ui-input" rows="2" bind:value={draft.forms} placeholder="Особые формы: форма = замена" aria-label="Особые формы"></textarea>
        <div class="voice-add-actions">
          <button class="ui-btn primary" disabled={!draft.written.trim() || !draft.alias.trim()}>Добавить</button>
        </div>
      </form>
    {/if}
    {#if aliases.list.length}<div class="ui-label voice-count">{aliases.list.length} в словаре</div>{/if}
    <ul class="voice-rules">
      {#each aliases.list as a (a.id)}
        <li>
          {#if editing === a.id}
            <form class="voice-add" onsubmit={(e) => save(e, a)}>
              <input class="ui-input" bind:value={edit.written} aria-label="Как в переводе" />
              <input class="ui-input" bind:value={edit.alias} aria-label="Как показывать" />
              <input class="ui-input" bind:value={edit.note} placeholder="Пояснение" aria-label="Пояснение" />
              <textarea class="ui-input" rows="3" bind:value={edit.forms} placeholder="Особые формы: форма = замена" aria-label="Особые формы"></textarea>
              <div class="voice-add-actions">
                <button type="button" class="ui-btn" onclick={() => (editing = null)}>Отмена</button>
                <button class="ui-btn primary">Сохранить</button>
              </div>
            </form>
          {:else}
            <span class="voice-rule alias-rule">
              <span><b>{a.written}</b> → <span class="voice-spoken">{a.alias}</span></span>
              {#if a.note}<span class="muted small">{a.note}</span>{/if}
              {#if Object.keys(a.forms).length}<span class="muted small">Формы: {Object.values(a.forms).join(', ')}</span>{/if}
            </span>
            {#if coordinator}
              <button class="ui-round small" onclick={() => startEdit(a)} title="Изменить" aria-label="Изменить {a.written}"><Icon name="edit" size={16} /></button>
              <button class="ui-round small" class:danger={confirmDelete === a.id}
                onclick={() => (confirmDelete === a.id ? deleteAlias(a.id) : (confirmDelete = a.id))}
                title={confirmDelete === a.id ? 'Нажмите ещё раз для удаления' : 'Удалить'} aria-label="Удалить {a.written}"><Icon name="trash" size={16} /></button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if aliases.loaded && !aliases.list.length}<p class="ui-hint">Словарь пока пуст.</p>{/if}
    {#if aliases.list.some((a) => a.source)}
      <p class="ui-hint">Источник: {[...new Set(aliases.list.map((a) => a.source).filter(Boolean))].join('; ')}.</p>
    {/if}
  </section>
</div>
