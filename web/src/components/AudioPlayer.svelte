<script>
  import {
    tts, setLang, setVoice, voicesFor, toggle, sentence, paragraph, pause, VOICE_DEFAULTS, playFromSessionStart, seek, locate,
  } from '../lib/tts.svelte.js';
  import { onBack } from '../lib/router.svelte.js';
  import { setTab } from '../lib/ui.svelte.js';
  import Icon from './Icon.svelte';


  /**
   * The phone's audio reading panel above the bottom navigation: transport row and, behind ⚙, the
   * voice of the current language (volume, tone, rate, voice — each language keeps its own).
   * Its height is published as --tts-h so the text can scroll above it.
   */

  /** @type {HTMLElement | undefined} */
  let panel = $state();
  /** @type {HTMLElement | undefined} */
  let drawer = $state();
  /** Transitions start after the first placement (the player must not slide in on opening). */
  let ready = $state(false);

  // ---- The settings below the controls ----
  // They always hang under the controls; with the settings closed the whole player is shifted down by
  // their height (they hide behind the bottom navigation). Only `transform` moves — the compositor
  // animates it without re-laying out the page, so the slide is smooth. --tts-h is the visible
  // height (the text scrolls above it).
  $effect(() => {
    const p = panel;
    const d = drawer;
    if (!p || !d) return;
    const place = () => {
      const h = d.offsetHeight;
      const open = tts.settingsOpen;
      p.style.transform = open ? '' : `translateY(${h}px)`;
      document.documentElement.style.setProperty('--tts-h', `${p.offsetHeight - (open ? 0 : h)}px`);
    };
    place();
    const ro = new ResizeObserver(place); // e.g. the "no voices" hint appears
    ro.observe(d);
    requestAnimationFrame(() => (ready = true));
    return () => ro.disconnect();
  });
  $effect(() => () => document.documentElement.style.removeProperty('--tts-h'));

  // "Back" (Android edge swipe) while the player is open pauses reading instead of leaving the app.
  // (false: nothing to do — "back" goes on to the leave warning)
  $effect(() =>
    onBack(() => {
      if (tts.settingsOpen) tts.settingsOpen = false;
      else if (tts.playing) pause();
      else return false;
    }),
  );

  // Swipes on the player: up opens the settings, down closes them; the player follows the finger
  // and settles open or closed past a third of the way (or on a quick flick).
  let y0 = 0, t0 = 0, dy = 0;
  /** null — not decided, true — dragging the player, false — not this gesture */
  let dragging = /** @type {boolean | null} */ (null);
  /** @param {TouchEvent} e */
  function dragStart(e) {
    const t = /** @type {HTMLElement} */ (e.target);
    dragging = e.touches.length === 1 && !t.closest('input, select, textarea') ? null : false;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
    dy = 0;
  }
  /** @param {TouchEvent} e */
  function dragMove(e) {
    if (dragging === false || !panel || !drawer) return;
    dy = e.touches[0].clientY - y0;
    if (dragging === null) {
      if (Math.abs(dy) < 10) return;
      dragging = tts.settingsOpen ? dy > 0 : dy < 0; // open: only down; closed: only up
      if (!dragging) return;
      panel.style.transition = 'none';
    }
    const h = drawer.offsetHeight;
    const off = Math.min(Math.max(0, (tts.settingsOpen ? 0 : h) + dy), h);
    panel.style.transform = `translateY(${off}px)`;
    e.preventDefault();
  }
  function dragEnd() {
    if (!dragging || !panel || !drawer) return (dragging = null);
    panel.style.transition = '';
    const h = drawer.offsetHeight;
    const far = Math.abs(dy) > Math.min(90, h / 3) || (Math.abs(dy) / Math.max(1, Date.now() - t0) > 0.6 && Math.abs(dy) > 30);
    if (far) tts.settingsOpen = !tts.settingsOpen;
    else panel.style.transform = tts.settingsOpen ? '' : `translateY(${h}px)`; // back where it was
    dragging = null;
  }

  // (not via ontouch… attributes: those are passive, and the drag must stop the page from moving)
  $effect(() => {
    const p = panel;
    if (!p) return;
    p.addEventListener('touchstart', dragStart, { passive: true });
    p.addEventListener('touchmove', dragMove, { passive: false });
    p.addEventListener('touchend', dragEnd);
    p.addEventListener('touchcancel', dragEnd);
    return () => {
      p.removeEventListener('touchstart', dragStart);
      p.removeEventListener('touchmove', dragMove);
      p.removeEventListener('touchend', dragEnd);
      p.removeEventListener('touchcancel', dragEnd);
    };
  });

  const v = $derived(tts[tts.lang]);
  const defaults = $derived(VOICE_DEFAULTS[tts.lang]);
  /** @typedef {'volume' | 'pitch' | 'rate'} Knob */
  /** @type {{ key: Knob, label: string, min: number, max: number, step: number, reset: boolean, show: (v: number) => string }[]} */
  const KNOBS = [
    { key: 'volume', label: 'Громкость', min: 0.1, max: 1, step: 0.05, reset: false, show: (x) => `${Math.round(x * 100)}%` },
    { key: 'pitch', label: 'Тон', min: 0.5, max: 2, step: 0.1, reset: true, show: (x) => x.toFixed(1) },
    { key: 'rate', label: 'Скорость', min: 0.5, max: 3, step: 0.1, reset: true, show: (x) => `${x.toFixed(1)}×` },
  ];
  /** @param {(typeof KNOBS)[number]} k @param {number} x */
  const set = (k, x) => setVoice(k.key, Number((Math.round(Math.min(k.max, Math.max(k.min, x)) / k.step) * k.step).toFixed(2)));

  const voices = $derived(voicesFor(tts.lang));
  // The progress line: the share of the book read; dragging its knob moves reading there.
  /** @type {number | null} */
  let drag = $state(null);
  /** Where the knob was let go: it stays there until reading has moved (the paper may still be loading). @type {number | null} */
  let held = $state(null);
  /** @type {typeof tts.place} */
  let heldFrom = null;
  let heldTimer = 0;
  $effect(() => {
    if (held !== null && tts.place !== heldFrom) held = null;
  });
  /** @param {number} frac */
  function drop(frac) {
    held = frac;
    heldFrom = tts.place;
    drag = null;
    clearTimeout(heldTimer);
    heldTimer = window.setTimeout(() => (held = null), 8000); // nothing happened (no connection…)
    seek(frac);
  }
  const shown = $derived(drag ?? held ?? tts.place?.progress ?? 0);
  const target = $derived(drag === null ? null : locate(drag));
  /** @param {number} f */
  const pct = (f) => (Math.round(f * 1000) / 10).toLocaleString('ru');

  // ▶: a tap plays/pauses; a long press reads from the first sentence on screen.
  let pressTimer = 0;
  let longPress = false;
  function pressStart() {
    longPress = false;
    pressTimer = window.setTimeout(() => {
      longPress = true;
      navigator.vibrate?.(15);
      playFromSessionStart();
    }, 550);
  }
  const pressEnd = () => clearTimeout(pressTimer);
  function playClick() {
    if (longPress) longPress = false;
    else toggle();
  }
</script>

<div class="tts-panel" class:ready bind:this={panel} role="region" aria-label="Аудиочтение">
  <div class="tts-bar">
  <div class="sheet-grip tts-grip" aria-hidden="true"></div>
  <div class="tts-progress">
    <input type="range" min="0" max="1000" step="1" value={Math.round(shown * 1000)} style:--done="{shown * 100}%"
      aria-label="Место в книге" aria-valuetext="{pct(shown)}%{target ? `, Текст ${target.paper}` : ''}"
      oninput={(e) => (drag = Number(e.currentTarget.value) / 1000)}
      onchange={(e) => drop(Number(e.currentTarget.value) / 1000)} />
    {#if drag !== null && target}<span class="tts-seek-tip" style:left="clamp(56px, {shown * 100}%, calc(100% - 96px))">Текст {target.paper} · {pct(shown)}%</span>{/if}
    <span class="tts-pct">{pct(shown)}%</span>
  </div>
  <!-- Language · ⏮ ⏪ ▶ ⏩ ⏭ · settings: the play button in the middle. -->
  <div class="tts-controls">
    <button class="icon-btn tts-lang" onclick={() => setLang(tts.lang === 'ru' ? 'en' : 'ru')}
      aria-label="Язык чтения: {tts.lang === 'ru' ? 'русский' : 'английский'}. Переключить" title="Язык чтения">{tts.lang.toUpperCase()}</button>
    <button class="icon-btn" onclick={() => paragraph(-1)} aria-label="Предыдущий абзац" title="Предыдущий абзац"><Icon name="skip-back" /></button>
    <button class="icon-btn" onclick={() => sentence(-1)} aria-label="Предыдущее предложение" title="Предыдущее предложение"><Icon name="rewind" /></button>
    <button class="tts-play" onclick={playClick} onpointerdown={pressStart} onpointerup={pressEnd} onpointerleave={pressEnd}
      onpointercancel={pressEnd} oncontextmenu={(e) => e.preventDefault()}
      aria-label={tts.playing ? 'Остановить' : 'Читать'} title="Читать / остановить · долгое нажатие — с начала сессии"><Icon name={tts.playing ? 'stop' : 'play'} size={24} /></button>
    <button class="icon-btn" onclick={() => sentence(1)} aria-label="Следующее предложение" title="Следующее предложение"><Icon name="fast-forward" /></button>
    <button class="icon-btn" onclick={() => paragraph(1)} aria-label="Следующий абзац" title="Следующий абзац"><Icon name="skip-forward" /></button>
    <button class="icon-btn" class:on={tts.settingsOpen} onclick={() => (tts.settingsOpen = !tts.settingsOpen)}
      aria-expanded={tts.settingsOpen} aria-label="Настройки голоса" title="Настройки голоса"><Icon name="settings" /></button>
  </div>
  </div>
  <!-- The voice settings: the lower part of the player, revealed as the player slides up. -->
  <div class="tts-drawer" bind:this={drawer} inert={!tts.settingsOpen} aria-hidden={!tts.settingsOpen}>
      <div class="tts-settings">
        <div class="tts-title">Голос для {tts.lang === 'ru' ? 'русского' : 'английского'} текста</div>
        {#each KNOBS as k (k.key)}
          <div class="tts-knob">
            <span class="tts-label">{k.label}</span>
            <span class="tts-value">{k.show(v[k.key])}</span>
            <input type="range" min={k.min} max={k.max} step={k.step} value={v[k.key]} aria-label={k.label}
              oninput={(e) => set(k, Number(e.currentTarget.value))} />
            {#if k.reset}
              <button class="icon-btn" onclick={() => set(k, defaults[k.key])} disabled={v[k.key] === defaults[k.key]}
                aria-label="{k.label}: по умолчанию ({k.show(defaults[k.key])})" title="По умолчанию: {k.show(defaults[k.key])}"><Icon name="reset" size={18} /></button>
            {:else}<span></span>{/if}
            <button class="icon-btn" onclick={() => set(k, v[k.key] - k.step)} aria-label="{k.label}: меньше"><Icon name="minus" /></button>
            <button class="icon-btn" onclick={() => set(k, v[k.key] + k.step)} aria-label="{k.label}: больше"><Icon name="plus" /></button>
          </div>
        {/each}
        <label class="tts-row">
          <span class="tts-label">Голос</span>
          <select class="text-input" value={v.voice} onchange={(e) => setVoice('voice', e.currentTarget.value)}>
            <option value="">Системный по умолчанию</option>
            {#each voices as x (x.name)}<option value={x.name}>{x.name}</option>{/each}
          </select>
        </label>
        {#if !voices.length}
          <p class="tts-hint">Голосов для этого языка браузер не нашёл. Если чтение не пойдёт — скачайте язык в настройках Android:
            «Синтез речи» → движок → «Установить голосовые данные».</p>
        {/if}
        <button class="link-btn tts-dict-link" onclick={() => setTab('voice')}>Словарь произношения</button>
      </div>
  </div>
</div>

