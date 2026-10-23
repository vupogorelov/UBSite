<script>
  import { settings, setSetting } from '../lib/settings.svelte.js';
  import { NAV_POOL, NAV_MAX, NAV_DEFAULT, parseNav } from '../lib/phonenav.js';
  import Icon from './Icon.svelte';
  import InfoTip from './InfoTip.svelte';
  import { SETTINGS_GROUPS } from '../../../shared/settings.js';

  /**
   * Settings → «Панели» (phone): glass bars, labels under the bottom bar's icons, and which sections
   * stand in the bottom bar and in what order. «Книга» is always first and «Ещё» last; a section
   * taken out of the bar is in «Ещё».
   */

  /** @typedef {import('../lib/phonenav.js').NavId} NavId */
  /** The two switches of the page (shared/settings.js: their labels and hints). */
  const ITEMS = /** @type {any[]} */ (SETTINGS_GROUPS.find((g) => g.title === 'Панели')?.items ?? []);
  const SWITCHES = ITEMS.filter((i) => i.type === 'toggle' && !i.hidden); // (hidden: changed elsewhere — the player's «Читать сразу»)
  /** «Вид нижней панели» */
  const STYLE = ITEMS.find((i) => i.key === 'navStyle');
  const values = /** @type {Record<string, any>} */ (settings);
  const bar = $derived(parseNav(settings.phoneNav));
  const rest = $derived(NAV_POOL.filter((s) => !bar.includes(s.id)));
  const full = $derived(bar.length >= NAV_MAX);
  /** @param {NavId} id */
  const info = (id) => /** @type {(typeof NAV_POOL)[number]} */ (NAV_POOL.find((s) => s.id === id));

  /** @param {NavId[]} list */
  const save = (list) => setSetting('phoneNav', list.join(','));
  /** @param {number} i @param {-1 | 1} dir */
  function move(i, dir) {
    const list = [...bar];
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    save(list);
  }
  /** @param {NavId} id */
  const remove = (id) => save(bar.filter((x) => x !== id));
  /** @param {NavId} id */
  const add = (id) => !full && save([...bar, id]);
</script>

<div class="nav-editor">
  <!-- (explanations in ⓘ, not as text under the settings) -->
  <div class="set-section">Вид<InfoTip text="Панели настраиваются только на телефоне." /></div>
  <div class="set-card">
    <div class="set-item">
      <b class="set-item-label set-item-name">{STYLE.label}<InfoTip text={STYLE.hint} /></b>
      <div class="ui-chips set-chips" role="radiogroup" aria-label={STYLE.label}>
        {#each STYLE.options as [value, label] (value)}
          <button class="ui-chip" class:on={settings.navStyle === value} role="radio" aria-checked={settings.navStyle === value}
            onclick={() => setSetting('navStyle', value)}>{label}</button>
        {/each}
      </div>
    </div>
    {#each SWITCHES as item (item.key)}
      {@const inactive = !!item.when && !item.when.values.includes(values[item.when.key])}
      {@const tip = [item.hint, inactive ? item.whenHint : ''].filter(Boolean).join(' ')}
      <label class="set-item set-switch" class:inactive>
        <span class="set-item-text"><b class="set-item-name">{item.label}{#if tip}<InfoTip text={tip} />{/if}</b></span>
        <input type="checkbox" class="ui-switch" checked={values[item.key]} disabled={inactive} onchange={(e) => setSetting(item.key, e.currentTarget.checked)} />
      </label>
    {/each}
  </div>

  <div class="set-section">Нижняя панель<InfoTip text="«Книга» всегда первая, «Ещё» — последнее; разделы не из панели — в «Ещё»." /></div>

  <!-- the bar as it will look -->
  <div class="nav-preview" class:icons={!settings.navLabels} class:air={settings.navStyle === 'air'} aria-hidden="true">
    <span><Icon name="book-open" size={20} /><i>Книга</i></span>
    {#each bar as id (id)}<span><Icon name={/** @type {any} */ (info(id).icon)} size={20} /><i>{info(id).label}</i></span>{/each}
    <span><Icon name="dots" size={20} /><i>Ещё</i></span>
  </div>

  <div class="set-section nav-head">В панели <span class="muted">{bar.length} из {NAV_MAX}</span></div>
  <ul class="set-list nav-list">
    <li class="nav-item fixed"><Icon name="book-open" size={18} /><span>Книга</span><span class="muted small">всегда первой</span></li>
    {#each bar as id, i (id)}
      <li class="nav-item">
        <Icon name={/** @type {any} */ (info(id).icon)} size={18} /><span>{info(id).label}</span>
        <button class="ui-round small plain" onclick={() => move(i, -1)} disabled={i === 0} aria-label="{info(id).label}: выше" title="Выше"><Icon name="up" size={18} /></button>
        <button class="ui-round small plain" onclick={() => move(i, 1)} disabled={i === bar.length - 1} aria-label="{info(id).label}: ниже" title="Ниже"><Icon name="down" size={18} /></button>
        <button class="ui-round small nav-out" onclick={() => remove(id)} aria-label="{info(id).label}: убрать в «Ещё»" title="Убрать в «Ещё»"><Icon name="minus" size={16} /></button>
      </li>
    {/each}
    <li class="nav-item fixed"><Icon name="dots" size={18} /><span>Ещё</span><span class="muted small">всегда последним</span></li>
  </ul>

  <div class="set-section">В «Ещё»</div>
  {#if rest.length}
    <ul class="set-list nav-list">
      {#each rest as s (s.id)}
        <li class="nav-item">
          <Icon name={/** @type {any} */ (s.icon)} size={18} /><span>{s.label}</span>
          <button class="ui-round small nav-in" onclick={() => add(s.id)} disabled={full} aria-label="{s.label}: в панель" title="В панель"><Icon name="plus" size={16} /></button>
        </li>
      {/each}
    </ul>
    {#if full}<p class="ui-hint nav-rule">В панели {NAV_MAX} из {NAV_MAX}: чтобы добавить раздел, сначала уберите другой.</p>{/if}
  {:else}
    <p class="ui-hint nav-rule">Все разделы — в панели.</p>
  {/if}

  <button class="ui-btn set-reset" onclick={() => setSetting('phoneNav', NAV_DEFAULT)} disabled={settings.phoneNav === NAV_DEFAULT}><Icon name="reset" size={18} />Вернуть как было</button>
</div>
