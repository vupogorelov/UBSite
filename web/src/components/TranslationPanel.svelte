<script>
  import { api } from '../lib/api.js';
  import { tr, openThread, votingSummary, STATUS_NAMES } from '../lib/translation.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';
  import { ui } from '../lib/ui.svelte.js';
  import { notify } from '../lib/notify.svelte.js';
  import GlossaryPanel from './GlossaryPanel.svelte';
  import Icon from './Icon.svelte';
  import SummaryPanel from './SummaryPanel.svelte';

  /** @type {{ visible: boolean, onnavigate?: () => void }} */
  let { visible, onnavigate } = $props();

  const translator = $derived(!!session.user?.isTranslator);
  /** Only translators vote, so only they have a queue. */
  const scope = $derived(ui.trScope === 'queue' && !translator ? 'voting' : ui.trScope);
  /** @type {import('../lib/api.js').Proposal[]} */
  let list = $state([]);
  let error = $state('');
  let loaded = '';

  // Reload when shown, when the scope changes and after any change in the public layer.
  $effect(() => {
    const s = scope;
    const key = `${s}:${tr.version}:${s === 'queue' ? notify.queue : ''}`;
    if (!visible || s === 'glossary' || s === 'summary' || key === loaded) return;
    loaded = key;
    api.proposals(s).then(
      (l) => ((list = l), (error = '')),
      (err) => (error = err.message),
    );
  });

  /** @param {MouseEvent} e @param {import('../lib/api.js').Proposal} p */
  function open(e, p) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    navigate(`/${p.ref}`);
    openThread(p.ref, { focus: p.id });
    onnavigate?.();
  }

  const ALL_SCOPES = /** @type {const} */ ([
    ['queue', 'Ждут меня'], ['voting', 'Голосование'], ['mine', 'Мои'], ['approved', 'Принятые'], ['glossary', 'Глоссарий'], ['summary', 'Сводка'],
  ]);
  /** @type {HTMLElement | undefined} */ let scopesRow = $state();
  // the chosen list's chip in view (opened on the glossary from the settings, it is past the row's edge)
  $effect(() => {
    void scope;
    if (visible) scopesRow?.querySelector('.ui-chip.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  const SCOPES = $derived(translator ? ALL_SCOPES : ALL_SCOPES.filter(([v]) => v !== 'queue'));
  const waiting = $derived(scope === 'voting' ? list.filter((p) => p.can.vote && p.votes.mine === null).length : 0);

  /** "осталось 3 дн." / "осталось 5 ч" until the end of voting. @param {string | null} closesAt */
  function timeLeft(closesAt) {
    if (!closesAt) return '';
    const ms = Date.parse(closesAt.replace(' ', 'T') + 'Z') - Date.now();
    if (ms <= 0) return 'срок истёк';
    const hours = Math.ceil(ms / 3_600_000);
    if (hours < 24) return `осталось ${hours} ч`;
    const days = Math.ceil(hours / 24);
    return `осталось ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }
</script>

<div class="notes-panel tr-panel">
  <div class="panel-head tr-head">
  <!-- the lists, then the glossary and the summary: chips in one scrolling row -->
  <div class="ui-chips tr-scopes" role="radiogroup" aria-label="Списки переводов" bind:this={scopesRow}>
    {#each SCOPES as [value, label] (value)}
      {#if value === 'glossary'}<span class="ui-chips-sep" aria-hidden="true"></span>{/if}
      <button class="ui-chip" class:on={scope === value} role="radio" aria-checked={scope === value} onclick={() => (ui.trScope = value)}>
        {label}{#if value === 'queue' && notify.queue}<span class="tr-n">{notify.queue}</span>{/if}
      </button>
    {/each}
  </div>
  {#if scope !== 'glossary' && scope !== 'summary'}
  {#if error}<div class="search-error">{error}</div>{/if}
  <div class="ui-label tr-count">
    <span>{list.length} {plural(list.length, 'предложение', 'предложения', 'предложений')}</span>
    {#if waiting}<span class="ui-chip small on">ждут вашего голоса: {waiting}</span>{/if}
  </div>
  {/if}
  </div>
  {#if scope === 'glossary'}
    <GlossaryPanel {visible} />
  {:else if scope === 'summary'}
    <SummaryPanel {visible} />
  {:else}
  {#if !list.length && !error}
    <div class="ui-empty">
      <span class="ui-tile big"><Icon name="translate" size={22} /></span>
      <b>{scope === 'queue' ? 'Всё проголосовано' : scope === 'mine' ? 'Черновиков пока нет' : 'Пока пусто'}</b>
      <p class="muted small">
        {#if scope === 'mine'}Выделите фрагмент русского текста и нажмите «Перевести» — появится ваш черновик.
        {:else if scope === 'queue'}Вы проголосовали по всем открытым предложениям.
        {:else if scope === 'approved'}Принятые варианты появятся здесь после голосования.
        {:else}Предложения появятся здесь, когда переводчики опубликуют их на голосование.{/if}
      </p>
    </div>
  {/if}
  <ol class="ui-cards tr-cards">
    {#each list as p (p.id)}
      <li>
        <a href="/{p.ref}" class="ui-card tr-card" onclick={(e) => open(e, p)}>
          <span class="ui-card-body">
            <span class="tr-card-top">
              <span class="ui-card-meta"><b>{p.ref}</b>{p.paperTitle ? ` · ${p.paperTitle}` : ''}</span>
              <span class="status-badge tr-status" data-status={p.status}>{STATUS_NAMES[p.status]}</span>
            </span>
            <span class="tr-was"><del>{p.original}</del></span>
            <span class="tr-now">{p.text}</span>
            {#if p.status !== 'draft'}
              <span class="ui-card-foot tr-foot">
                {votingSummary(p)}{p.votes.mine !== null ? ' · ваш голос учтён' : ''}{p.status === 'voting' ? ` · ${timeLeft(p.closesAt)}` : ''}
              </span>
            {/if}
          </span>
        </a>
      </li>
    {/each}
  </ol>
  {#if list.length}
    <p class="ui-hint tr-rule">
      {#if session.user?.isTranslator}Вы переводчик: публикуете варианты и голосуете.{:else}Вы можете делать черновики и обсуждать; публикуют и голосуют переводчики.{/if}
      {#if tr.config}Правило: ≥{Math.round(tr.config.threshold * 100)}% за, кворум {tr.config.quorum}, срок {tr.config.durationDays} дн.{/if}
    </p>
  {/if}
  {/if}
</div>
