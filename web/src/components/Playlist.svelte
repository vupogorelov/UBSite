<script module>
  /** The contents (titles of papers and sections), once per page. @type {Promise<any> | null} */
  let tocOnce = null;
</script>

<script>
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { tts, recordingList, playTrack } from '../lib/tts.svelte.js';
  import { onBack } from '../lib/router.svelte.js';
  import { portal } from '../lib/portal.js';
  import { swipeClose } from '../lib/swipe.js';
  import { paperLabel, sectionLabel } from '../lib/format.js';
  import { clock } from '../lib/clock.js';
  import Icon from './Icon.svelte';

  /**
   * The recording's playlist: its files in book order, by paper (a paper's heading with its whole
   * length), a row per file — its sections and titles, its length; the file being heard is marked.
   * A tap plays that file from its start. Opens scrolled to the current file.
   * @type {{ onclose: () => void }}
   */
  let { onclose } = $props();

  let toc = $state(/** @type {{ papers: { id: number, titleRu: string, titleEn: string }[], sections: { paperId: number, num: number, titleRu: string, titleEn: string }[] } | null} */ (null));
  tocOnce ??= api.toc().catch(() => (tocOnce = null));
  tocOnce?.then((t) => (toc = t));

  $effect(() => onBack(() => void onclose()));

  const groups = $derived.by(() => {
    const tracks = recordingList[tts.lang] ?? [];
    const titles = new Map((toc?.sections ?? []).map((s) => [`${s.paperId}:${s.num}`, tts.lang === 'en' ? s.titleEn || s.titleRu : s.titleRu]));
    const paperTitles = new Map((toc?.papers ?? []).map((p) => [p.id, tts.lang === 'en' ? p.titleEn || p.titleRu : p.titleRu]));
    /** @type {{ paper: number, title: string, duration: number, rows: { file: string, paper: number, section: number, label: string, title: string, duration: number }[] }[]} */
    const out = [];
    for (const t of tracks) {
      let g = out.at(-1);
      if (!g || g.paper !== t.paper) out.push((g = { paper: t.paper, title: paperTitles.get(t.paper) ?? '', duration: 0, rows: [] }));
      const first = t.sections[0];
      const last = t.sections.at(-1) ?? first;
      g.rows.push({
        file: t.file,
        paper: t.paper,
        section: first,
        label: first === 0 ? 'Вступление' : `§${sectionLabel(t.paper, first)}${last !== first ? `–${sectionLabel(t.paper, last)}` : ''}`,
        title: first === 0 ? '' : t.sections.map((s) => titles.get(`${t.paper}:${s}`) ?? '').filter(Boolean).join(' · '),
        duration: t.duration ?? 0,
      });
      g.duration += t.duration ?? 0;
    }
    return out;
  });

  /** @type {HTMLElement | undefined} */
  let list = $state();
  let scrolled = false;
  // opened: the current file in the middle of the list
  $effect(() => {
    if (scrolled || !list || !groups.length || !toc) return;
    scrolled = true;
    void tick().then(() => list?.querySelector('.pl-row.on')?.scrollIntoView({ block: 'center' }));
  });

  /** @param {number} sec */
  const hours = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} ч ${Math.round((sec % 3600) / 60)} мин` : `${Math.round(sec / 60)} мин`);

  /** @param {{ paper: number, section: number }} r */
  function choose(r) {
    playTrack(r.paper, r.section);
    onclose();
  }
</script>

<div use:portal>
  <button class="sheet-scrim" aria-label="Закрыть" onclick={onclose}></button>
  <div class="sheet ui-sheet ui-picker playlist" role="dialog" aria-label="Плейлист" use:swipeClose={{ dirs: ['down'], onclose }}>
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="ui-sheet-head">
      <button class="ui-round plain" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
      <b>Плейлист</b>
      <span></span>
    </div>
    <div class="ui-picker-list pl-list" bind:this={list}>
      {#if !toc}<p class="ui-hint pl-wait">Загрузка…</p>{/if}
      {#each groups as g (g.paper)}
        <div class="pl-paper">
          <span class="pl-paper-name">{paperLabel(g.paper)}{g.title ? `. ${g.title}` : ''}</span>
          <span class="pl-dur">{hours(g.duration)}</span>
        </div>
        {#each g.rows as r (r.file)}
          {@const on = tts.track?.file === r.file}
          <button class="pl-row" class:on aria-current={on ? 'true' : undefined} onclick={() => choose(r)}>
            <span class="pl-mark">{#if on}<Icon name={tts.playing ? 'headphones' : 'pause'} size={16} />{/if}</span>
            <span class="pl-num" class:wide={!r.title}>{r.label}</span>{#if r.title}<span class="pl-title">{r.title}</span>{/if}
            <span class="pl-dur">{r.duration ? clock(r.duration) : ''}</span>
          </button>
        {/each}
      {/each}
    </div>
  </div>
</div>
