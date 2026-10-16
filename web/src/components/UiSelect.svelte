<script>
  import { onBack } from '../lib/router.svelte.js';
  import { portal } from '../lib/portal.js';
  import { swipeClose } from '../lib/swipe.js';
  import Icon from './Icon.svelte';

  /**
   * A choice from a list, in the app's own style (not the system's picker): the trigger shows the
   * chosen value; a tap opens a sheet — × · the title · the options as rows with a radio; a tap on one
   * chooses it and closes. On a computer the sheet is a card in the middle of the screen.
   * @type {{
   *   value: string,
   *   options: { value: string, label: string, hint?: string, group?: string }[],
   *   title: string,
   *   label?: string,
   *   onchange: (value: string) => void,
   *   class?: string,
   *   variant?: 'row' | 'inline',
   *   icon?: any,
   *   searchable?: boolean,
   *   placeholder?: string,
   *   empty?: string,
   * }}
   */
  let {
    value, options, title, label = '', onchange, class: cls = '', variant = 'row', icon = null,
    searchable = false, placeholder = '', empty = 'Ничего не найдено',
  } = $props();

  let open = $state(false);
  /** The search in the sheet (searchable lists). */
  let query = $state('');
  const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/ё/g, 'е');
  const shown = $derived.by(() => {
    const q = norm(query.trim());
    return q ? options.filter((o) => norm(`${o.label} ${o.hint ?? ''}`).includes(q)) : options;
  });
  $effect(() => {
    if (!open) query = '';
  });
  /** (with a placeholder nothing is chosen until a value matches) */
  const chosen = $derived(options.find((o) => o.value === value) ?? (placeholder ? null : options[0]));
  $effect(() => {
    if (open) return onBack(() => void (open = false));
  });
  /** @param {string} v */
  function pick(v) {
    open = false;
    if (v !== value) onchange(v);
  }
</script>

<button type="button" class="ui-select-trigger {cls}" class:inline={variant === 'inline'} onclick={() => (open = true)}
  aria-haspopup="dialog" aria-expanded={open} aria-label="{title}: {chosen?.label ?? ''}">
  {#if icon}<Icon name={icon} size={20} />{/if}
  {#if label}<span class="ui-select-label">{label}</span>{/if}
  <span class="ui-select-value" class:placeholder={!chosen}>{chosen?.label ?? placeholder}</span>
  <Icon name="chevron" size={variant === 'inline' ? 14 : 16} />
</button>

{#if open}
  <div use:portal>
    <button class="sheet-scrim" aria-label="Закрыть" onclick={() => (open = false)}></button>
    <div class="sheet ui-sheet ui-picker" class:searchable role="dialog" aria-label={title} use:swipeClose={{ dirs: ['down'], onclose: () => (open = false) }}>
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="ui-sheet-head">
        <button class="ui-round plain" onclick={() => (open = false)} aria-label="Закрыть"><Icon name="close" /></button>
        <b>{title}</b>
        <span></span>
      </div>
      {#if searchable}
        <label class="ui-search ui-picker-search">
          <Icon name="search" size={18} />
          <input bind:value={query} placeholder="Найти" aria-label="Найти в списке" />
          {#if query}<button class="ui-search-clear" onclick={(e) => (e.preventDefault(), (query = ''))} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
        </label>
      {/if}
      <div class="ui-options ui-picker-list" role="radiogroup" aria-label={title}>
        {#if !shown.length}<p class="ui-hint ui-picker-empty">{options.length ? 'Ничего не найдено' : empty}</p>{/if}
        {#each shown as o, i (o.value)}
          {#if o.group && o.group !== shown[i - 1]?.group}<div class="ui-label ui-picker-group">{o.group}</div>{/if}
          <button class="ui-option" role="radio" aria-checked={o.value === value} class:on={o.value === value} onclick={() => pick(o.value)}>
            <span><b>{o.label}</b>{#if o.hint}<span class="muted small">{o.hint}</span>{/if}</span>
            <span class="ui-radio"></span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
