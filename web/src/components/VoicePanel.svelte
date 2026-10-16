<script>
  import { tts, setLang, sayOnce, voicesFor, loadRecordings, voiceChoice, voiceOptions, chooseVoice, currentRate, nextRate, stepPitch, NARRATOR } from '../lib/tts.svelte.js';
  import { dict, loadDict, addRule, updateRule, deleteRule, applyDict } from '../lib/pronunciations.svelte.js';
  import { withStress, toPlus } from '../lib/pronounce.js';
  import { session } from '../lib/session.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';
  import { plural } from '../lib/format.js';

  /**
   * The sidebar's "Озвучка": tone and rate of the voice per language (as in the phone's player) and,
   * below, the pronunciation dictionary shared by everybody (coordinators edit it).
   * @type {{ visible: boolean }}
   */
  let { visible } = $props();

  $effect(() => {
    if (visible) void loadDict();
    if (visible) loadRecordings();
  });

  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  const v = $derived(tts[tts.lang]);
  const voices = $derived(voicesFor(tts.lang));
  /** This language is heard from its recording (the narrator). */
  const recording = $derived(v.source === 'audio' && tts.recorded.includes(tts.lang));

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
    <div class="ui-chips voice-chips" role="radiogroup" aria-label="Язык чтения">
      {#each /** @type {const} */ ([['ru', 'Русский'], ['en', 'English']]) as [id, label] (id)}
        <button class="ui-chip" class:on={tts.lang === id} role="radio" aria-checked={tts.lang === id} onclick={() => setLang(id)}>{label}</button>
      {/each}
    </div>
  </div>

  <section class="voice-knobs">
    <div class="ui-label">Голос</div>
    <!-- as the phone's player: the voice (the narrator or a synthesized one), the speed and the tone in one row -->
    <div class="tts-list voice-card">
      <UiSelect class="tts-list-row" label="Голос" title="Голос для {tts.lang === 'ru' ? 'русского' : 'английского'} текста" value={voiceChoice()}
        onchange={(x) => (chooseVoice(x), x !== NARRATOR && !tts.playing && sayOnce(applyDict(SAMPLE[tts.lang], tts.lang)))} options={voiceOptions()} />
      <div class="tts-list-row tts-pace">
        <span class="tts-label">Скорость</span>
        <button class="tts-rate" onclick={nextRate} aria-label="Скорость {currentRate()}×, нажмите — быстрее" title="Нажмите — быстрее (после 2× — снова 0.6×)">{Number(currentRate().toFixed(2))}×</button>
        {#if !recording}
          <span class="tts-label tts-tone-label">Тон</span>
          <button class="ui-round small" onclick={() => stepPitch(-1)} disabled={v.pitch <= 0.5} aria-label="Тон ниже"><Icon name="minus" size={16} /></button>
          <span class="tts-value tts-tone">{v.pitch.toFixed(1)}</span>
          <button class="ui-round small" onclick={() => stepPitch(1)} disabled={v.pitch >= 2} aria-label="Тон выше"><Icon name="plus" size={16} /></button>
        {/if}
      </div>
    </div>
    {#if recording}
      <p class="muted small">Книгу читает диктор; подсвечивается абзац, который звучит.</p>
    {:else}
    {#if !voices.length}
      <p class="muted small">Браузер не нашёл голосов для этого языка.</p>
    {:else if voices.length < 3}
      <p class="muted small">Больше голосов: Windows → Параметры → Время и язык → Речь → «Добавить голоса»; после установки перезапустите браузер.</p>
    {/if}
    <button class="ui-btn voice-try" onclick={() => sayOnce(applyDict(SAMPLE[tts.lang], tts.lang))}><Icon name="play" size={14} />Прослушать пример</button>
    {/if}
  </section>
  {/if}

  <section class="voice-dict">
    {#if !device.mobile}<div class="ui-label">Словарь произношения</div>{/if}
    <p class="ui-hint">{tts.lang === 'ru' ? 'Русский' : 'Английский'} · общий для всех. Слово заменяется с начала: правило для «Небадон» сработает и для «Небадона», «Небадону».
      Ударение — <b>+</b> перед ударной гласной: <span class="mono">Небад+он</span>.</p>
    {#if coordinator}
      <!-- a new rule: a card with its two fields, «listen» and «add» -->
      <form class="voice-add voice-add-card" onsubmit={add}>
        <input class="ui-input" bind:value={written} placeholder="Как написано" aria-label="Как написано" />
        <input class="ui-input" bind:value={spoken} placeholder="Как читать" aria-label="Как читать" />
        <div class="voice-add-actions">
          <button type="button" class="ui-round" onclick={() => sayOnce(withStress(spoken))} disabled={!spoken.trim()} aria-label="Прослушать" title="Прослушать"><Icon name="play" size={18} /></button>
          <button class="ui-btn primary" disabled={!written.trim() || !spoken.trim()}>Добавить</button>
        </div>
      </form>
    {/if}
    {#if dict.list.filter((p) => p.lang === tts.lang).length > 8}
      <label class="ui-search">
        <Icon name="search" size={18} />
        <input bind:value={filter} placeholder="Найти в словаре" aria-label="Найти в словаре" />
        {#if filter}<button class="ui-search-clear" onclick={(e) => (e.preventDefault(), (filter = ''))} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
      </label>
    {/if}
    {#if rules.length}<div class="ui-label voice-count">{rules.length} {plural(rules.length, 'слово', 'слова', 'слов')}</div>{/if}
    <ul class="voice-rules">
      {#each rules as p (p.id)}
        <li>
          {#if editing === p.id}
            <form class="voice-add" onsubmit={(e) => saveEdit(e, p)}>
              <input class="ui-input" bind:value={editWritten} aria-label="Как написано" />
              <input class="ui-input" bind:value={editSpoken} aria-label="Как читать" />
              <div class="voice-add-actions">
                <button type="button" class="ui-btn" onclick={() => (editing = null)}>Отмена</button>
                <button class="ui-btn primary">Сохранить</button>
              </div>
            </form>
          {:else}
            <span class="voice-rule"><b>{p.written}</b><span class="voice-spoken">{p.spoken}</span></span>
            <button class="ui-round small" onclick={() => sayOnce(p.spoken)} title="Прослушать" aria-label="Прослушать {p.written}"><Icon name="play" size={16} /></button>
            {#if coordinator}
              <button class="ui-round small" onclick={() => startEdit(p)} title="Изменить" aria-label="Изменить {p.written}"><Icon name="edit" size={16} /></button>
              <button class="ui-round small" class:danger={confirmDelete === p.id}
                onclick={() => (confirmDelete === p.id ? deleteRule(p.id) : (confirmDelete = p.id))}
                title={confirmDelete === p.id ? 'Нажмите ещё раз для удаления' : 'Удалить'} aria-label="Удалить {p.written}"><Icon name="trash" size={16} /></button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if dict.loaded && !rules.length}
      <p class="ui-hint">{filter ? 'Ничего не найдено.' : `Для ${tts.lang === 'ru' ? 'русского' : 'английского'} пока пусто.`}</p>
    {/if}
  </section>
</div>
