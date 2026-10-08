<script>
  import { tts, setLang, setVoice, sayOnce, voicesFor, VOICE_DEFAULTS } from '../lib/tts.svelte.js';
  import { dict, loadDict, addRule, updateRule, deleteRule, applyDict } from '../lib/pronunciations.svelte.js';
  import { withStress, toPlus } from '../lib/pronounce.js';
  import { session } from '../lib/session.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * The sidebar's "Озвучка": tone and rate of the voice per language (as in the phone's player) and,
   * below, the pronunciation dictionary shared by everybody (coordinators edit it).
   * @type {{ visible: boolean }}
   */
  let { visible } = $props();

  $effect(() => {
    if (visible) void loadDict();
  });

  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  const v = $derived(tts[tts.lang]);
  const defaults = $derived(VOICE_DEFAULTS[tts.lang]);
  const voices = $derived(voicesFor(tts.lang));
  /** @typedef {'pitch' | 'rate'} Knob */
  /** @type {{ key: Knob, label: string, min: number, max: number, step: number, show: (x: number) => string }[]} */
  const KNOBS = [
    { key: 'pitch', label: 'Тон', min: 0.5, max: 2, step: 0.1, show: (x) => x.toFixed(1) },
    { key: 'rate', label: 'Темп', min: 0.5, max: 3, step: 0.1, show: (x) => `${x.toFixed(1)}×` },
  ];
  /** @param {(typeof KNOBS)[number]} k @param {number} x */
  const set = (k, x) => setVoice(k.key, Number((Math.round(Math.min(k.max, Math.max(k.min, x)) / k.step) * k.step).toFixed(2)));

  const SAMPLE = {
    ru: 'Локальная вселенная Небадон входит в сверхвселенную Орвонтон; её столица — Салвингтон.',
    en: 'The local universe of Nebadon belongs to the superuniverse of Orvonton; its capital is Salvington.',
  };

  // ---- The dictionary ----
  let written = $state('');
  let spoken = $state('');
  let filter = $state('');
  /** @type {number | null} */ let editing = $state(null);
  let editWritten = $state('');
  let editSpoken = $state('');
  /** @type {number | null} */ let confirmDelete = $state(null);

  const rules = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    return dict.list.filter((p) => p.lang === tts.lang && (!f || p.written.toLowerCase().includes(f) || p.spoken.toLowerCase().includes(f)));
  });

  /** @param {SubmitEvent} e */
  async function add(e) {
    e.preventDefault();
    if (!written.trim() || !spoken.trim()) return;
    if (await addRule({ lang: tts.lang, written: written.trim(), spoken: withStress(spoken.trim()) })) written = spoken = '';
  }
  /** @param {import('../lib/api.js').Pronunciation} p */
  function startEdit(p) {
    editing = p.id;
    editWritten = p.written;
    editSpoken = toPlus(p.spoken);
  }
  /** @param {SubmitEvent} e @param {import('../lib/api.js').Pronunciation} p */
  async function saveEdit(e, p) {
    e.preventDefault();
    if (await updateRule(p.id, { lang: p.lang, written: editWritten.trim(), spoken: withStress(editSpoken.trim()) })) editing = null;
  }
</script>

<div class="voice-panel">
  <!-- On the phone the player has its own voice settings (and the language): only the dictionary here. -->
  {#if !device.mobile}
  <div class="panel-head voice-head">
    <div class="segmented" role="radiogroup" aria-label="Язык чтения">
      {#each /** @type {const} */ ([['ru', 'Русский'], ['en', 'English']]) as [id, label] (id)}
        <button role="radio" aria-checked={tts.lang === id} class:active={tts.lang === id} onclick={() => setLang(id)}>{label}</button>
      {/each}
    </div>
  </div>

  <section class="voice-knobs">
    <div class="box-title">Голос</div>
    {#each KNOBS as k (k.key)}
      <div class="voice-knob">
        <div class="voice-knob-head">
          <span>{k.label}</span>
          <span class="muted">{k.show(v[k.key])}</span>
          <span class="spacer"></span>
          <button class="icon-btn small-btn" onclick={() => set(k, defaults[k.key])} disabled={v[k.key] === defaults[k.key]}
            title="По умолчанию: {k.show(defaults[k.key])}" aria-label="{k.label}: по умолчанию"><Icon name="reset" size={16} /></button>
        </div>
        <div class="voice-knob-row">
          <button class="icon-btn small-btn" onclick={() => set(k, v[k.key] - k.step)} aria-label="{k.label}: меньше"><Icon name="minus" size={16} /></button>
          <input type="range" min={k.min} max={k.max} step={k.step} value={v[k.key]} aria-label={k.label}
            oninput={(e) => set(k, Number(e.currentTarget.value))} />
          <button class="icon-btn small-btn" onclick={() => set(k, v[k.key] + k.step)} aria-label="{k.label}: больше"><Icon name="plus" size={16} /></button>
        </div>
      </div>
    {/each}
    <label class="voice-pick">
      <span>Голос</span>
      <select class="text-input" value={v.voice} onchange={(e) => (setVoice('voice', e.currentTarget.value), tts.playing || sayOnce(applyDict(SAMPLE[tts.lang], tts.lang)))}>
        <option value="">Системный по умолчанию</option>
        {#each voices as x (x.name)}<option value={x.name}>{x.name}{x.online ? ' · онлайн' : ''}</option>{/each}
      </select>
    </label>
    {#if !voices.length}
      <p class="muted small">Браузер не нашёл голосов для этого языка.</p>
    {:else if voices.length < 3}
      <p class="muted small">Больше голосов: Windows → Параметры → Время и язык → Речь → «Добавить голоса»; после установки перезапустите браузер.</p>
    {/if}
    <button class="btn voice-try" onclick={() => sayOnce(applyDict(SAMPLE[tts.lang], tts.lang))}><Icon name="play" size={14} />Прослушать пример</button>
  </section>
  {/if}

  <section class="voice-dict">
    <div class="box-title">Словарь произношения{#if device.mobile}{' · '}{tts.lang === 'ru' ? 'русский' : 'английский'}{/if}</div>
    <p class="muted small">Общий для всех. Слово заменяется с начала, поэтому правило для «Небадон» сработает и для «Небадона», «Небадону».
      Ударение — знак <b>+</b> перед ударной гласной: <span class="mono">Небад+он</span>.</p>
    {#if coordinator}
      <form class="voice-add" onsubmit={add}>
        <input class="text-input" bind:value={written} placeholder="Как написано" aria-label="Как написано" />
        <input class="text-input" bind:value={spoken} placeholder="Как читать" aria-label="Как читать" />
        <div class="row-end">
          <button type="button" class="btn" onclick={() => sayOnce(withStress(spoken))} disabled={!spoken.trim()}><Icon name="play" size={14} />Прослушать</button>
          <button class="btn primary" disabled={!written.trim() || !spoken.trim()}>Добавить</button>
        </div>
      </form>
    {/if}
    {#if dict.list.filter((p) => p.lang === tts.lang).length > 8}
      <input class="text-input" bind:value={filter} placeholder="Найти в словаре" aria-label="Найти в словаре" />
    {/if}
    <ul class="voice-rules">
      {#each rules as p (p.id)}
        <li>
          {#if editing === p.id}
            <form class="voice-add" onsubmit={(e) => saveEdit(e, p)}>
              <input class="text-input" bind:value={editWritten} aria-label="Как написано" />
              <input class="text-input" bind:value={editSpoken} aria-label="Как читать" />
              <div class="row-end">
                <button type="button" class="btn" onclick={() => (editing = null)}>Отмена</button>
                <button class="btn primary">Сохранить</button>
              </div>
            </form>
          {:else}
            <span class="voice-rule"><b>{p.written}</b> → {p.spoken}</span>
            <button class="icon-btn small-btn" onclick={() => sayOnce(p.spoken)} title="Прослушать" aria-label="Прослушать {p.written}"><Icon name="play" size={14} /></button>
            {#if coordinator}
              <button class="icon-btn small-btn" onclick={() => startEdit(p)} title="Изменить" aria-label="Изменить {p.written}"><Icon name="edit" size={14} /></button>
              <button class="icon-btn small-btn" class:danger={confirmDelete === p.id}
                onclick={() => (confirmDelete === p.id ? deleteRule(p.id) : (confirmDelete = p.id))}
                title={confirmDelete === p.id ? 'Нажмите ещё раз для удаления' : 'Удалить'} aria-label="Удалить {p.written}"><Icon name="trash" size={14} /></button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if dict.loaded && !rules.length}
      <p class="muted small">{filter ? 'Ничего не найдено.' : `Для ${tts.lang === 'ru' ? 'русского' : 'английского'} пока пусто.`}</p>
    {/if}
  </section>
</div>
