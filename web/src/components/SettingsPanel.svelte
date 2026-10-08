<script>
  import { SETTINGS_GROUPS, settingDefaults } from '../../../shared/settings.js';
  import { settings, setSetting, workspace } from '../lib/settings.svelte.js';
  import { can } from '../lib/session.svelte.js';
  import Icon from './Icon.svelte';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';

  /** @type {{ open: boolean, onclose: () => void }} */
  let { open, onclose } = $props();
  // Like every drawer: "back" (Android gesture) and a swipe close it.
  $effect(() => {
    if (open) return onBack(() => onclose());
  });

  /** Untyped access for the schema-driven form; values are validated on the server. */
  const values = /** @type {Record<string, any>} */ (settings);
  const set = /** @type {(key: string, value: unknown) => void} */ (setSetting);

  /** Resets the personal settings only; shared ones belong to everybody in the workspace. */
  function reset() {
    const defaults = /** @type {Record<string, unknown>} */ (settingDefaults());
    for (const item of SETTINGS_GROUPS.filter((g) => g.scope === 'user').flatMap((g) => g.items)) set(item.key, defaults[item.key]);
  }

  /** @param {number} v @param {number} step */
  const fmt = (v, step) => (step < 1 ? v.toFixed(1) : String(v));
</script>

{#if open}
  <button class="drawer-scrim" aria-label="Закрыть настройки" onclick={onclose}></button>
  <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title" use:swipeClose={{ dirs: ['right', 'down'], onclose }}>
    <header class="drawer-head">
      <div>
        <h2 id="settings-title">Настройки</h2>
        <div class="muted small">Пространство: {workspace.name || '…'} · ваши личные настройки в нём</div>
      </div>
      <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
    </header>

    {#each SETTINGS_GROUPS as group (group.title)}
      <fieldset class="group" disabled={group.scope === 'workspace' && !can.edit}>
        <legend>{group.title}{#if group.scope === 'workspace'}<span class="scope-note"> · общие для пространства</span>{/if}</legend>
        {#if group.scope === 'workspace' && !can.edit}
          <div class="hint">Меняют редакторы и владельцы пространства.</div>
        {/if}
        {#each group.items as item (item.key)}
          {@const inactive = !!item.when && !item.when.values.includes(values[item.when.key])}
          <div class="setting" class:inactive>
            {#if item.type === 'choice'}
              <div class="setting-label">{item.label}</div>
              <div class="segmented" role="radiogroup" aria-label={item.label}>
                {#each item.options as [value, label] (value)}
                  <button role="radio" aria-checked={values[item.key] === value} class:active={values[item.key] === value}
                    onclick={() => set(item.key, value)}>{label}</button>
                {/each}
              </div>
            {:else if item.type === 'range'}
              <label class="setting-label" for="set-{item.key}">
                {item.label}<output>{item.valueLabels?.[values[item.key]] ?? `${fmt(values[item.key], item.step)}${item.unit}`}</output>
              </label>
              <input id="set-{item.key}" type="range" min={item.min} max={item.max} step={item.step}
                value={values[item.key]} disabled={inactive}
                oninput={(e) => set(item.key, Math.round(Number(e.currentTarget.value) * 100) / 100)} />
            {:else if item.type === 'text'}
              <label class="setting-label" for="set-{item.key}">
                <span>{#if item.swatch}<span class="dot" data-color={item.swatch}></span>{/if}{item.label}</span>
              </label>
              <input id="set-{item.key}" class="text-input" maxlength={item.maxLength} value={values[item.key]}
                onchange={(e) => set(item.key, e.currentTarget.value.trim())} />
            {:else}
              <label class="toggle">
                <input type="checkbox" checked={values[item.key]} disabled={inactive} onchange={(e) => set(item.key, e.currentTarget.checked)} />
                <span>{item.label}</span>
              </label>
            {/if}
            {#if item.hint}<div class="hint">{item.hint}</div>{/if}
            {#if inactive && item.whenHint}<div class="hint">{item.whenHint}</div>{/if}
          </div>
        {/each}
      </fieldset>
    {/each}

    <button class="link-btn" onclick={reset}>Сбросить мои настройки</button>
  </div>
{/if}
