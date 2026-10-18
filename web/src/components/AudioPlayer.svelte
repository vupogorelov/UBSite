<script>
  import { book } from '../lib/lang.svelte.js';
  import {
    tts, setLang, setVoice, voicesFor, toggle, sentence, paragraph, pause, playFromSessionStart, seek, seekBack, SKIP, seekTrack,
    setSleep, readingRef,
  } from '../lib/tts.svelte.js';
  import { voiceChoice, voiceOptions, chooseVoice, currentRate, nextRate, stepPitch } from '../lib/voice-choice.js';
  import { locate } from '../lib/bookmap.svelte.js';
  import { clock } from '../lib/clock.js';
  import { sectionLabel } from '../lib/format.js';
  import Playlist from './Playlist.svelte';
  import { onBack } from '../lib/router.svelte.js';
  import { setTab } from '../lib/ui.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';
  import { plural } from '../lib/format.js';
  import { dict, loadDict } from '../lib/pronunciations.svelte.js';


  /**
   * The phone's audio reading panel above the bottom navigation: transport row and, behind ⚙, the
   * voice of the current language (volume, tone, rate, voice — each language keeps its own), or its
   * recording ("Запись", where the language has one: volume and speed).
   * Its height is published as --tts-h so the text can scroll above it.
   */

  /** @type {HTMLElement | undefined} */
  let panel = $state();
  /** @type {HTMLElement | undefined} */
  let drawer = $state();
  /** Transitions start after the first placement (the player must not slide in on opening). */
  let ready = $state(false);
  /**
   * Air glass: the player is the upper part of the bottom bar's own form (one glass with the
   * sections' buttons); the settings open by growing that form upwards, nothing slides.
   */
  const air = $derived(settings.navStyle === 'air');

  // ---- A bookmark on the paragraph heard (or paused at; not yet read — the one at the top of the
  // screen): the reader makes it, the same as «Книга» held ----
  function bookmarkHere() {
    window.dispatchEvent(new CustomEvent('ub-here', { detail: { what: 'bookmark', ref: readingRef() ?? undefined } }));
  }

  // ---- The sleep timer ----
  const SLEEP = [
    { value: '', label: 'Выключен' },
    ...[15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} минут` })),
    { value: 'paper', label: 'До конца Текста' },
  ];
  /** Now, to show the minutes left (a minute's tick while the timer is on). */
  let now = $state(Date.now());
  $effect(() => {
    if (tts.sleep.until === null) return;
    const t = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(t);
  });
  const sleepLeft = $derived(tts.sleep.until === null ? null : Math.max(1, Math.ceil((tts.sleep.until - now) / 60_000)));
  const sleepValue = $derived(tts.sleep.paper ? 'paper' : tts.sleep.until !== null ? 'on' : '');
  /** @param {string} v */
  function chooseSleep(v) {
    if (v === 'on') return; // (the timer as it goes)
    now = Date.now();
    setSleep(v === 'paper' ? 'paper' : v ? Number(v) : null);
  }

  // ---- The settings below the controls ----
  // They always hang under the controls; with the settings closed the whole player is shifted down by
  // their height (they hide behind the bottom navigation). Only `transform` moves — the compositor
  // animates it without re-laying out the page, so the slide is smooth. --tts-h is the visible
  // height (the text scrolls above it).
  $effect(() => {
    const p = panel;
    const d = drawer;
    if (!p || !d) return;
    const grows = air; // (Air glass: the form grows; otherwise the player slides)
    /** @type {number} */ let settle = 0;
    const place = () => {
      if (grows) {
        // The part above the sections' buttons is what covers the text — told once the form has
        // settled: told on every frame of its growth, the whole paper would be laid out again each
        // frame (the text's bottom padding follows it), and the tap would answer late.
        p.style.transform = '';
        clearTimeout(settle);
        settle = window.setTimeout(() => {
          const nav = /** @type {HTMLElement | null} */ (document.querySelector('.bottom-nav'))?.offsetHeight ?? 0;
          document.documentElement.style.setProperty('--tts-h', `${p.offsetHeight - nav}px`);
        }, ready ? 180 : 0);
        return;
      }
      const h = d.offsetHeight;
      const open = tts.settingsOpen;
      p.style.transform = open ? '' : `translateY(${h}px)`;
      document.documentElement.style.setProperty('--tts-h', `${p.offsetHeight - (open ? 0 : h)}px`);
    };
    place();
    const ro = new ResizeObserver(place); // e.g. the "no voices" hint appears; Air glass: the form grows
    ro.observe(d);
    if (grows) ro.observe(p);
    const stop = () => clearTimeout(settle);
    requestAnimationFrame(() => (ready = true));
    return () => (ro.disconnect(), stop());
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
  // The progress line is close to the grip, so on a touch screen it does not take a touch itself
  // (CSS): a finger going sideways there moves the place, going up or down drags the player, and a
  // mere tap does nothing — an aimed swipe up cannot knock the place away.
  let x0 = 0, y0 = 0, t0 = 0, dy = 0;
  /** null — not decided, true — dragging the player, false — not this gesture */
  let dragging = /** @type {boolean | null} */ (null);
  /** The touch began on the progress line (and may become a seek). */
  let onLine = false;
  /** Seeking with the finger along the line. */
  let scrubbing = false;
  /** @type {HTMLInputElement | undefined} */
  let line = $state();
  /** The share of the book under the finger (the knob's own half-width off each end). @param {number} x */
  function fracAt(x) {
    if (!line) return 0;
    const r = line.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left - 6) / Math.max(1, r.width - 12)));
  }
  /** @param {TouchEvent} e */
  function dragStart(e) {
    const t = /** @type {HTMLElement} */ (e.target);
    dragging = e.touches.length === 1 && !t.closest('input, select, textarea') ? null : false;
    onLine = dragging === null && !!t.closest('.tts-progress');
    scrubbing = false;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
    dy = 0;
  }
  /** @param {TouchEvent} e */
  function dragMove(e) {
    if (scrubbing) {
      drag = fracAt(e.touches[0].clientX);
      return e.preventDefault();
    }
    if (dragging === false || !panel || !drawer) return;
    dy = e.touches[0].clientY - y0;
    if (dragging === null) {
      const dx = e.touches[0].clientX - x0;
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      if (onLine && Math.abs(dx) > Math.abs(dy)) {
        scrubbing = true;
        dragging = false;
        drag = fracAt(e.touches[0].clientX);
        return e.preventDefault();
      }
      if (Math.abs(dy) < 10) return;
      dragging = tts.settingsOpen ? dy > 0 : dy < 0; // open: only down; closed: only up
      if (!dragging) return;
      if (air) return e.preventDefault(); // (the form does not follow the finger: the swipe opens or closes)
      panel.style.transition = 'none';
      panel.classList.add('dragging'); // the settings are seen while the finger pulls them
    }
    if (air) return e.preventDefault();
    const h = drawer.offsetHeight;
    const off = Math.min(Math.max(0, (tts.settingsOpen ? 0 : h) + dy), h);
    panel.style.transform = `translateY(${off}px)`;
    e.preventDefault();
  }
  function dragEnd() {
    if (scrubbing) {
      scrubbing = false;
      if (drag !== null) drop(drag);
      return (dragging = null);
    }
    if (!dragging || !panel || !drawer) return (dragging = null);
    if (air) {
      if (Math.abs(dy) > 30) tts.settingsOpen = !tts.settingsOpen;
      return (dragging = null);
    }
    panel.style.transition = '';
    const p = panel;
    setTimeout(() => p.classList.remove('dragging'), 200); // after the player has settled
    const h = drawer.offsetHeight;
    const far = Math.abs(dy) > Math.min(90, h / 3) || (Math.abs(dy) / Math.max(1, Date.now() - t0) > 0.6 && Math.abs(dy) > 30);
    if (far) tts.settingsOpen = !tts.settingsOpen;
    else panel.style.transform = tts.settingsOpen ? '' : `translateY(${h}px)`; // back where it was
    dragging = null;
  }

  function dragCancel() {
    if (!scrubbing) return dragEnd();
    scrubbing = false;
    drag = null;
    dragging = null;
  }

  // (not via ontouch… attributes: those are passive, and the drag must stop the page from moving)
  $effect(() => {
    const p = panel;
    if (!p) return;
    p.addEventListener('touchstart', dragStart, { passive: true });
    p.addEventListener('touchmove', dragMove, { passive: false });
    p.addEventListener('touchend', dragEnd);
    p.addEventListener('touchcancel', dragCancel);
    return () => {
      p.removeEventListener('touchstart', dragStart);
      p.removeEventListener('touchmove', dragMove);
      p.removeEventListener('touchend', dragEnd);
      p.removeEventListener('touchcancel', dragCancel);
    };
  });

  const v = $derived(tts[tts.lang]);
  /** This language is heard from its recording (the narrator): no tone, no dictionary; the playlist. */
  const recording = $derived(v.source === 'audio' && tts.recorded.includes(tts.lang));
  const voices = $derived(voicesFor(tts.lang));
  /** Words of the pronunciation dictionary for the current language (the row's value). */
  const dictCount = $derived(dict.list.filter((p) => p.lang === tts.lang).length);
  $effect(() => {
    if (tts.settingsOpen) void loadDict();
  });
  // The progress line: the share of the book read; dragging its knob moves reading there.
  let drag = $state(/** @type {number | null} */ (null));
  /** Where the knob was let go: it stays there until reading has moved (the paper may still be loading). */
  let held = $state(/** @type {number | null} */ (null));
  /** @type {typeof tts.place} */
  let heldFrom = null;
  let heldTimer = 0;
  $effect(() => {
    if (held !== null && tts.place !== heldFrom) held = null;
  });
  /** @param {number} frac */
  function drop(frac) {
    if (trackMode) {
      drag = null;
      return seekTrack(frac); // (within the file: no "Вернуться")
    }
    held = frac;
    heldFrom = tts.place;
    drag = null;
    clearTimeout(heldTimer);
    heldTimer = window.setTimeout(() => (held = null), 8000); // nothing happened (no connection…)
    const was = seek(frac);
    // a jump through the book is big: for a while the old place is a tap away
    clearTimeout(backTimer);
    back = was;
    if (was) backTimer = window.setTimeout(() => (back = null), 8000);
  }
  /** Where reading was before the last move along the line. */
  let back = $state(/** @type {{ paper: number, key: string, s: number } | null} */ (null));
  let backTimer = 0;
  function goBack() {
    if (!back) return;
    clearTimeout(backTimer);
    seekBack(back);
    back = null;
  }
  /**
   * A recording is heard (or paused): the line is its file — the place in it, its length; dragging
   * moves within the file. Otherwise the line is the whole book.
   */
  const trackMode = $derived(recording && tts.track !== null && tts.track.duration > 0);
  const trackShare = $derived(trackMode && tts.track ? Math.min(1, tts.track.time / tts.track.duration) : 0);
  /** The file's sections: "§2", "§9–10", "Вступление". */
  const trackName = $derived.by(() => {
    const t = tts.track;
    if (!t) return '';
    const a = t.sections[0];
    const b = t.sections.at(-1) ?? a;
    return a === 0 ? 'Вступление' : `§${sectionLabel(t.paper, a)}${b !== a ? `–${sectionLabel(t.paper, b)}` : ''}`;
  });
  const shown = $derived(drag ?? (trackMode ? trackShare : (held ?? tts.place?.progress ?? 0)));
  const target = $derived(drag === null || trackMode ? null : locate(drag));
  /** The playlist sheet is open. */
  let playlistOpen = $state(false);
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
  {#if back}
    <button class="tts-back" onclick={goBack}><Icon name="reset" size={16} />Вернуться к {back.key.includes(':') ? back.key : `Тексту ${back.paper}`}</button>
  {/if}
  <div class="tts-bar">
  <div class="tts-progress">
    <input bind:this={line} type="range" min="0" max="1000" step="1" value={Math.round(shown * 1000)} style:--done="{shown * 100}%"
      aria-label={trackMode ? `Место в записи: Текст ${tts.track?.paper}, ${trackName}` : 'Место в книге'}
      aria-valuetext={trackMode && tts.track ? `${clock(shown * tts.track.duration)} из ${clock(tts.track.duration)}` : `${pct(shown)}%${target ? `, Текст ${target.paper}` : ''}`}
      oninput={(e) => (drag = Number(e.currentTarget.value) / 1000)}
      onchange={(e) => drop(Number(e.currentTarget.value) / 1000)} />
    {#if drag !== null && trackMode && tts.track}
      <span class="tts-seek-tip" style:left="clamp(56px, {shown * 100}%, calc(100% - 96px))">{trackName} · {clock(shown * tts.track.duration)}</span>
    {:else if drag !== null && target}<span class="tts-seek-tip" style:left="clamp(56px, {shown * 100}%, calc(100% - 96px))">Текст {target.paper} · {pct(shown)}%</span>{/if}
    {#if sleepValue}<span class="tts-sleep" title="Таймер сна">{sleepValue === 'paper' ? 'до конца' : `${sleepLeft} мин`}</span>{/if}
    {#if trackMode && tts.track}
      <span class="tts-pct tts-time">{clock(shown * tts.track.duration)} / {clock(tts.track.duration)}</span>
    {:else}
      <span class="tts-pct">{pct(shown)}%</span>
    {/if}
    <!-- a bookmark on the paragraph heard now, in one tap -->
    <button class="icon-btn small-btn tts-mark" onclick={bookmarkHere} aria-label="Закладка на абзац, который звучит" title="Закладка на абзац, который звучит"><Icon name="bookmark" size={16} /></button>
  </div>
  <!-- Language · ⏮ ⏪ ▶ ⏩ ⏭ · settings: the play button in the middle. -->
  <div class="tts-controls">
    <!-- reading in English, only the English is on the page: the switch rests -->
    <button class="icon-btn tts-lang" onclick={() => setLang(tts.lang === 'ru' ? 'en' : 'ru')} disabled={book.main === 'en'}
      aria-label="Язык чтения: {tts.lang === 'ru' ? 'русский' : 'английский'}. Переключить" title="Язык чтения">{tts.lang.toUpperCase()}</button>
    <button class="icon-btn" onclick={() => paragraph(-1)} aria-label="Предыдущий абзац" title="Предыдущий абзац"><Icon name="skip-back" /></button>
    <button class="icon-btn" onclick={() => sentence(-1)} aria-label={recording ? `Назад на ${SKIP} секунд` : 'Предыдущее предложение'} title={recording ? `Назад на ${SKIP} с` : 'Предыдущее предложение'}><Icon name="rewind" /></button>
    <button class="tts-play" onclick={playClick} onpointerdown={pressStart} onpointerup={pressEnd} onpointerleave={pressEnd}
      onpointercancel={pressEnd} oncontextmenu={(e) => e.preventDefault()}
      aria-label={tts.playing ? 'Остановить' : 'Читать'} title="Читать / остановить · долгое нажатие — с начала сессии"><Icon name={tts.playing ? 'stop' : 'play'} size={24} /></button>
    <button class="icon-btn" onclick={() => sentence(1)} aria-label={recording ? `Вперёд на ${SKIP} секунд` : 'Следующее предложение'} title={recording ? `Вперёд на ${SKIP} с` : 'Следующее предложение'}><Icon name="fast-forward" /></button>
    <button class="icon-btn" onclick={() => paragraph(1)} aria-label="Следующий абзац" title="Следующий абзац"><Icon name="skip-forward" /></button>
    <button class="icon-btn" class:on={tts.settingsOpen} onclick={() => (tts.settingsOpen = !tts.settingsOpen)}
      aria-expanded={tts.settingsOpen} aria-label="Настройки голоса" title="Настройки голоса"><Icon name="settings" /></button>
  </div>
  </div>
  <!-- The voice settings: the lower part of the player, revealed as the player slides up. -->
  <div class="tts-drawer" bind:this={drawer} inert={!tts.settingsOpen} aria-hidden={!tts.settingsOpen}>
      <!-- (whose voice: the RU / EN switch above says; screen readers hear it from the region's label) -->
      <div class="tts-settings" role="group" aria-label="Голос для {tts.lang === 'ru' ? 'русского' : 'английского'} текста">
        <!-- one card: the voice (the narrator or a synthesized one), the speed and the tone in one row,
             then the playlist (the narrator) or the pronunciation dictionary (a synthesized voice) -->
        <div class="tts-list">
          <UiSelect class="tts-list-row" label="Голос" title="Голос для {tts.lang === 'ru' ? 'русского' : 'английского'} текста"
            value={voiceChoice()} onchange={chooseVoice} options={voiceOptions()} />
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
          <!-- the sleep timer: reading stops by itself (the minutes left — by the progress line) -->
          <UiSelect class="tts-list-row" label="Таймер сна" title="Таймер сна"
            value={sleepValue} onchange={chooseSleep}
            options={sleepValue === 'on' ? [{ value: 'on', label: `Осталось ${sleepLeft} мин` }, { value: '', label: 'Выключить' }, ...SLEEP.slice(1)] : SLEEP} />
          {#if recording}
            <button class="tts-list-row" onclick={() => (playlistOpen = true)}>
              <span class="tts-label">Плейлист</span>
              <span class="tts-list-value">{tts.track ? `Текст ${tts.track.paper} · ${trackName}` : ''}</span>
              <Icon name="chevron" size={16} />
            </button>
          {:else}
            <button class="tts-list-row" onclick={() => setTab('voice')}>
              <span class="tts-label">Словарь озвучки</span>
              <span class="tts-list-value">{dictCount ? `${dictCount} ${plural(dictCount, 'слово', 'слова', 'слов')}` : ''}</span>
              <Icon name="chevron" size={16} />
            </button>
          {/if}
        </div>


      </div>
  </div>
</div>
{#if playlistOpen}<Playlist onclose={() => (playlistOpen = false)} />{/if}

