<script>
  import { settings, setSetting } from '../lib/settings.svelte.js';
  import Icon from './Icon.svelte';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';

  /** "Aa" on the phone: the reading settings people change while reading. @type {{ onclose: () => void, onall: () => void }} */
  let { onclose, onall } = $props();
  $effect(() => onBack(() => onclose()));

  /** @param {number} d */
  const size = (d) => setSetting('fontSize', Math.min(26, Math.max(14, settings.fontSize + d)));
  const THEMES = /** @type {const} */ ([['light', 'Светлая'], ['paper', 'Бумага'], ['dark', 'Тёмная'], ['graphite', 'Графит']]);
</script>

<button class="sheet-scrim" aria-label="Закрыть" onclick={onclose}></button>
<div class="sheet" role="dialog" aria-label="Настройки чтения" use:swipeClose={{ dirs: ['down'], onclose }}>
  <div class="sheet-grip" aria-hidden="true"></div>
  <div class="quick-size">
    <button class="quick-btn" onclick={() => size(-1)} disabled={settings.fontSize <= 14} aria-label="Мельче"><span style:font-size="15px">A</span></button>
    <span class="quick-value">{settings.fontSize} px</span>
    <button class="quick-btn" onclick={() => size(1)} disabled={settings.fontSize >= 26} aria-label="Крупнее"><span style:font-size="24px">A</span></button>
  </div>
  <div class="quick-themes" role="radiogroup" aria-label="Тема">
    {#each THEMES as [id, label] (id)}
      <button role="radio" aria-checked={settings.theme === id} class:active={settings.theme === id} data-theme-swatch={id}
        onclick={() => setSetting('theme', id)}><span class="swatch-dot"></span>{label}</button>
    {/each}
  </div>
  <div class="segmented" role="radiogroup" aria-label="Шрифт">
    {#each [['serif', 'С засечками'], ['sans', 'Geist'], ['roboto', 'Roboto']] as [id, label] (id)}
      <button role="radio" aria-checked={settings.fontFamily === id} class:active={settings.fontFamily === id}
        onclick={() => setSetting('fontFamily', /** @type {any} */ (id))}>{label}</button>
    {/each}
  </div>
  <div class="segmented" role="radiogroup" aria-label="Английский оригинал">
    {#each [['full', 'English полностью'], ['collapsed', 'Свёрнут'], ['hidden', 'Скрыт']] as [id, label] (id)}
      <button role="radio" aria-checked={settings.enMode === id} class:active={settings.enMode === id}
        onclick={() => setSetting('enMode', /** @type {any} */ (id))}>{label}</button>
    {/each}
  </div>
  <button class="btn sheet-wide" onclick={onall}><Icon name="settings" size={18} />Все настройки</button>
</div>
