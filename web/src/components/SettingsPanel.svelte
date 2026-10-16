<script>
  import { SETTINGS_GROUPS, settingDefaults } from '../../../shared/settings.js';
  import { settings, setSetting, workspace } from '../lib/settings.svelte.js';
  import { can, session } from '../lib/session.svelte.js';
  import IntegrationPage from './IntegrationPage.svelte';
  import AliasesPage from './AliasesPage.svelte';
  import { aliases, loadAliases } from '../lib/aliases.svelte.js';
  import NavEditor from './NavEditor.svelte';
  import { NAV_POOL, parseNav } from '../lib/phonenav.js';
  import Icon from './Icon.svelte';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';
  import { offline, offlinePossible, bytesText } from '../lib/offline.svelte.js';
  import { outbox } from '../lib/outbox.svelte.js';
  import { rec } from '../lib/recordings.svelte.js';
  import DevicePage from './DevicePage.svelte';

  /**
   * Settings in two levels, as in phone settings apps: the sections list their groups as rows (an icon,
   * the name, a summary of the current values, ›); a row opens the group's own page with its settings.
   * @type {{ open: boolean, onclose: () => void, onglossary?: () => void }}
   */
  let { open, onclose, onglossary } = $props();

  /** @typedef {import('../../../shared/settings.js').SettingGroup} SettingGroup */
  /** @typedef {import('../../../shared/settings.js').SettingDef} SettingDef */

  /** The open group's page (its title), or null for the list. @type {string | null} */
  let page = $state(null);
  const group = $derived(SETTINGS_GROUPS.find((g) => g.title === page) ?? null);
  /** Integrations (administrators): not a group of settings but a page of its own. */
  const INTEGRATION = 'Английский текст';
  const integration = $derived(page === INTEGRATION);
  /** The dictionary of names (everybody reads, coordinators edit): a page of its own, opened from "Текст". */
  const NAMES = 'Словарь названий';
  const TEXT_GROUP = 'Текст';
  const names = $derived(page === NAMES);
  /** What this device keeps (DevicePage): a page of its own. */
  const DEVICE = 'Это устройство';
  const device = $derived(page === DEVICE);
  /** Its row's summary: the book, the recording kept, what waits. */
  const deviceSummary = $derived.by(() => {
    const kept = Object.values(rec.saved).reduce((s, n) => s + n, 0);
    const parts = [
      !offlinePossible ? 'книга не хранится в этом браузере' : offline.state === 'ready' ? 'книга и поиск без сети' : offline.state === 'loading' ? 'книга сохраняется' : 'книга сохранится при связи',
      rec.job ? `запись скачивается` : kept ? `запись ${bytesText(kept)}` : '',
      outbox.items.length ? `ждут отправки: ${outbox.items.length}` : '',
    ];
    return parts.filter(Boolean).join(' · ');
  });
  $effect(() => {
    if (open) void loadAliases();
  });
  // Each opening starts at the list.
  $effect(() => {
    if (!open) page = null;
  });
  // Like every drawer: "back" (Android gesture) and a swipe close it — from a group's page "back"
  // returns to the list first.
  $effect(() => {
    if (open) {
      return onBack(() => {
        if (page === NAMES) page = TEXT_GROUP;
        else if (page !== null) page = null;
        else onclose();
      });
    }
  });
  /** A group with an editor of its own instead of the schema form. */
  const NAV_GROUP = 'Панели';
  /** The group's icon (names in shared/settings.js are Icon names). @param {SettingGroup} g */
  const iconOf = (g) => /** @type {any} */ (g.icon);

  /** Sections in the order of their first group. */
  const sections = $derived(
    [...new Set(SETTINGS_GROUPS.map((g) => g.section))].map((name) => ({ name, groups: SETTINGS_GROUPS.filter((g) => g.section === name) })),
  );

  /** Untyped access for the schema-driven form; values are validated on the server. */
  const values = /** @type {Record<string, any>} */ (settings);
  const set = /** @type {(key: string, value: unknown) => void} */ (setSetting);

  /** Resets the personal settings only; shared ones belong to everybody in the workspace. */
  function reset() {
    const defaults = /** @type {Record<string, unknown>} */ (settingDefaults());
    for (const item of SETTINGS_GROUPS.filter((g) => g.scope === 'user').flatMap((g) => g.items)) {
      if (!item.hidden) set(item.key, defaults[item.key]);
    }
  }

  /** @param {number} v @param {number} step */
  const fmt = (v, step) => (step < 1 ? v.toFixed(1) : String(v));

  /** A setting's current value as text. @param {SettingDef} item */
  function shown(item) {
    const v = values[item.key];
    if (item.type === 'choice') return item.options.find(([value]) => value === v)?.[1] ?? '';
    if (item.type === 'range') return item.valueLabels?.[v] ?? `${fmt(v, item.step)}${item.unit}`;
    if (item.type === 'text') return v;
    return v ? 'вкл.' : 'выкл.';
  }
  /** The row's summary: the first values, and how many switches are on. @param {SettingGroup} g */
  function summary(g) {
    if (g.title === NAV_GROUP) return [['Книга', ...parseNav(values.phoneNav).map((id) => NAV_POOL.find((x) => x.id === id)?.label), 'Ещё'].join(' · '), values.navStyle === 'air' && 'Air glass', values.glassBars && 'стекло', !values.navLabels && 'без подписей', !values.barsAutoHide && 'панели не прячутся'].filter(Boolean).join(' · ');
    const items = g.items.filter((i) => !i.hidden && (!i.when || i.when.values.includes(values[i.when.key]))); // only what applies now
    const parts = items.filter((i) => i.type !== 'toggle').slice(0, 3).map(shown).filter(Boolean);
    const toggles = items.filter((i) => i.type === 'toggle');
    if (parts.length < 3 && toggles.length) parts.push(`включено ${toggles.filter((i) => values[i.key]).length} из ${toggles.length}`);
    return parts.join(' · ');
  }
</script>

{#if open}
  <button class="drawer-scrim" aria-label="Закрыть настройки" onclick={onclose}></button>
  <div class="drawer settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title" use:swipeClose={{ dirs: ['right', 'down'], onclose }}>
    <header class="drawer-head">
      {#if group || integration || names || device}
        <button class="ui-round plain" onclick={() => (page = names ? TEXT_GROUP : null)} aria-label={names ? TEXT_GROUP : 'Все настройки'} title={names ? TEXT_GROUP : 'Все настройки'}><Icon name="back" /></button>
      {/if}
      <div class="settings-head-text">
        <h2 id="settings-title">{group ? group.title : integration ? INTEGRATION : names ? NAMES : device ? DEVICE : 'Настройки'}</h2>
        <div class="set-sub">
          {#if integration}Интеграции · для всей платформы{:else if device}Что хранится здесь и работает без сети{:else if names}Общий для всех · ведут координаторы{:else if group?.scope === 'workspace'}Общие для «{workspace.name || '…'}»{:else}Личные · пространство «{workspace.name || '…'}»{/if}
        </div>
      </div>
      <button class="ui-round plain" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
    </header>

    {#if integration}
      <IntegrationPage />
    {:else if device}
      <DevicePage />
    {:else if names}
      <AliasesPage />
    {:else if !group}
      <!-- the list: sections of rows -->
      {#each sections as s (s.name)}
        <div class="set-section">{s.name}</div>
        <div class="set-list">
          {#each s.groups as g (g.title)}
            <button class="set-row" onclick={() => (page = g.title)}>
              <span class="ui-tile set-row-icon"><Icon name={iconOf(g)} size={18} /></span>
              <span class="set-row-text">
                <b>{g.title}</b>
                <span class="muted small ellipsis">{summary(g)}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          {/each}
        </div>
      {/each}
      <!-- this device: what is kept here (the book by itself; the recording by choice; what waits) -->
      <div class="set-section">Это устройство</div>
      <div class="set-list">
        <button class="set-row" onclick={() => (page = DEVICE)}>
          <span class="ui-tile set-row-icon"><Icon name={outbox.items.some((o) => o.state === 'failed') ? 'alert' : 'cloud-download'} size={18} /></span>
          <span class="set-row-text">
            <b>{DEVICE}</b>
            <span class="muted small ellipsis">{deviceSummary}</span>
            {#if offline.state === 'loading' || rec.job}
              <span class="set-progress" role="progressbar" aria-label="Сохраняется"><span style:width="{rec.job ? ((rec.job.bytes + rec.job.fileBytes) / (rec.job.total || 1)) * 100 : (offline.bytes / (offline.total || 1)) * 100}%"></span></span>
            {/if}
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      {#if session.user?.isAdmin}
        <!-- the platform's links to other sources (administrators) -->
        <div class="set-section">Интеграции</div>
        <div class="set-list">
          <button class="set-row" onclick={() => (page = INTEGRATION)}>
            <span class="ui-tile set-row-icon"><Icon name="globe" size={18} /></span>
            <span class="set-row-text">
              <b>{INTEGRATION}</b>
              <span class="muted small ellipsis">Uversa Press · обновления оригинала, отчёты</span>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      {/if}
      <button class="ui-btn set-reset" onclick={reset}><Icon name="reset" size={18} />Сбросить мои настройки</button>
      <p class="ui-hint set-reset-hint">Только ваши личные настройки в этом пространстве; общие для пространства не меняются.</p>
    {:else if group.title === NAV_GROUP}
      <NavEditor />
    {:else}
      <!-- a group's page -->
      {#if group.scope === 'workspace' && !can.edit}
        <p class="ui-hint set-locked"><Icon name="lock" size={14} />Меняют редакторы и владельцы пространства.</p>
      {/if}
      {#if group.title === 'Чаты'}
        <!-- as it will look: the chat's background, a message from someone, one's own -->
        <div class="chat-preview tg-chat" aria-hidden="true">
          <div class="tg-row"><div class="tg-bubble"><b class="tg-name">Ирина</b>Как вы понимаете слова «Отец не скрывается»?<span class="tg-meta">10:24</span></div></div>
          <div class="tg-row own"><div class="tg-bubble">Это значит, что Он рядом — всегда.<span class="tg-meta">10:26</span></div></div>
        </div>
      {/if}
      <fieldset class="set-card" disabled={group.scope === 'workspace' && !can.edit}>
        <legend class="sr-only">{group.title}</legend>
        {#each group.items.filter((i) => !i.hidden) as item (item.key)}
          {@const inactive = !!item.when && !item.when.values.includes(values[item.when.key])}
          {#if item.type === 'toggle'}
            <!-- a switch: the name and its hint, the switch on the right; the whole row toggles -->
            <label class="set-item set-switch" class:inactive>
              <span class="set-item-text">
                <b>{item.label}</b>
                {#if item.hint}<span>{item.hint}</span>{/if}
                {#if inactive && item.whenHint}<span>{item.whenHint}</span>{/if}
              </span>
              <input type="checkbox" class="ui-switch" checked={values[item.key]} disabled={inactive} onchange={(e) => set(item.key, e.currentTarget.checked)} />
            </label>
          {:else}
            <div class="set-item" class:set-text={item.type === 'text'} class:inactive>
              {#if item.type === 'choice' && item.swatches}
                <b class="set-item-label">{item.label}<span class="set-swatch-name">{shown(item)}</span></b>
                <div class="set-swatches" role="radiogroup" aria-label={item.label}>
                  {#each item.options as [value, label] (value)}
                    <button class="set-swatch" data-swatch="{item.key}-{value}" class:on={values[item.key] === value} role="radio"
                      aria-checked={values[item.key] === value} aria-label={label} title={label} onclick={() => set(item.key, value)}></button>
                  {/each}
                </div>
              {:else if item.type === 'choice'}
                <b class="set-item-label">{item.label}</b>
                <div class="ui-chips set-chips" role="radiogroup" aria-label={item.label}>
                  {#each item.options as [value, label] (value)}
                    <button class="ui-chip" class:on={values[item.key] === value} role="radio" aria-checked={values[item.key] === value}
                      disabled={inactive} onclick={() => set(item.key, value)}>{label}</button>
                  {/each}
                </div>
              {:else if item.type === 'range'}
                <label class="set-item-label set-range-head" for="set-{item.key}">
                  <b>{item.label}</b><output>{item.valueLabels?.[values[item.key]] ?? `${fmt(values[item.key], item.step)}${item.unit}`}</output>
                </label>
                <input id="set-{item.key}" class="set-range" type="range" min={item.min} max={item.max} step={item.step}
                  value={values[item.key]} disabled={inactive}
                  oninput={(e) => set(item.key, Math.round(Number(e.currentTarget.value) * 100) / 100)} />
              {:else}
                <label class="set-item-label" for="set-{item.key}">
                  <b>{#if item.swatch}<span class="dot" data-color={item.swatch}></span>{/if}{item.label}</b>
                </label>
                <input id="set-{item.key}" class="ui-input" maxlength={item.maxLength} value={values[item.key]}
                  onchange={(e) => set(item.key, e.currentTarget.value.trim())} />
              {/if}
              {#if item.hint}<span class="set-item-hint">{item.hint}</span>{/if}
              {#if inactive && item.whenHint}<span class="set-item-hint">{item.whenHint}</span>{/if}
            </div>
          {/if}
        {/each}
      </fieldset>
      {#if group.title === TEXT_GROUP}
        <!-- the dictionaries of the text: shared by everybody -->
        <div class="set-section">Словари</div>
        <div class="set-list">
          <button class="set-row" onclick={() => (page = NAMES)}>
            <span class="ui-tile set-row-icon"><Icon name="book-open" size={18} /></span>
            <span class="set-row-text">
              <b>{NAMES}</b>
              <span class="muted small ellipsis">{aliases.list.length ? `${aliases.list.length} названий · ` : ''}Салвингтон → Спасоград</span>
            </span>
            <Icon name="chevron" size={16} />
          </button>
          {#if onglossary}
            <!-- the translation glossary (in «Перевод»): its terms light up in pairs over the text -->
            <button class="set-row" onclick={onglossary}>
              <span class="ui-tile set-row-icon"><Icon name="translate" size={18} /></span>
              <span class="set-row-text">
                <b>Глоссарий терминов</b>
                <span class="muted small ellipsis">Thought Adjuster → Настройщик Мышления · в разделе «Перевод»</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
{/if}
