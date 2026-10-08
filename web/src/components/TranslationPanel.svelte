<script>
  import { api } from '../lib/api.js';
  import { tr, openThread, votingSummary, STATUS_NAMES } from '../lib/translation.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';
  import { ui } from '../lib/ui.svelte.js';
  import { notify } from '../lib/notify.svelte.js';
  import GlossaryPanel from './GlossaryPanel.svelte';
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

<div class="notes-panel">
  <div class="panel-head">
  <div class="segmented small-seg" role="radiogroup" aria-label="Списки переводов">
    {#each SCOPES as [value, label] (value)}
      <button role="radio" aria-checked={scope === value} class:active={scope === value} onclick={() => (ui.trScope = value)}>
        {label}{#if value === 'queue' && notify.queue}<span class="seg-count">{notify.queue}</span>{/if}
      </button>
    {/each}
  </div>
  {#if scope !== 'glossary' && scope !== 'summary'}
  <p class="hint">
    {#if session.user?.isTranslator}Вы переводчик: публикуете варианты и голосуете.{:else}Вы можете делать черновики и обсуждать; публикуют и голосуют переводчики.{/if}
    {#if tr.config}Правило: ≥{Math.round(tr.config.threshold * 100)}% за, кворум {tr.config.quorum}, срок {tr.config.durationDays} дн.{/if}
  </p>
  {#if error}<div class="search-error">{error}</div>{/if}
  <div class="search-summary">
    {list.length} {plural(list.length, 'предложение', 'предложения', 'предложений')}
    {#if waiting}<span class="facet active">ждут вашего голоса: {waiting}</span>{/if}
  </div>
  {/if}
  </div>
  {#if scope === 'glossary'}
    <GlossaryPanel {visible} />
  {:else if scope === 'summary'}
    <SummaryPanel {visible} />
  {:else}
  {#if !list.length && !error}
    <p class="muted small">
      {#if scope === 'mine'}Выделите фрагмент русского текста и нажмите «Перевести» — появится ваш черновик.
      {:else if scope === 'queue'}Вы проголосовали по всем открытым предложениям.
      {:else}Пока пусто.{/if}
    </p>
  {/if}
  <ol class="results">
    {#each list as p (p.id)}
      <li>
        <a href="/{p.ref}" class="result" onclick={(e) => open(e, p)}>
          <div class="result-head">
            <b>{p.ref}</b><span class="ellipsis">{p.paperTitle ?? ''}</span><span class="spacer"></span>
            <span class="status-badge" data-status={p.status}>{STATUS_NAMES[p.status]}</span>
          </div>
          <div class="result-ru"><del class="muted">{p.original}</del></div>
          <div class="result-ru"><ins>{p.text}</ins></div>
          {#if p.status !== 'draft'}
            <div class="note-date">
              {votingSummary(p)}{p.votes.mine !== null ? ' · ваш голос учтён' : ''}{p.status === 'voting' ? ` · ${timeLeft(p.closesAt)}` : ''}
            </div>
          {/if}
        </a>
      </li>
    {/each}
  </ol>
  {/if}
</div>
