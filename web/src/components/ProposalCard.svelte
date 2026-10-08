<script>
  import { api } from '../lib/api.js';
  import { change, votingSummary, STATUS_NAMES, openThread } from '../lib/translation.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { formatTime } from '../lib/notes.svelte.js';
  import { wordDiff } from '../lib/diff.js';
  import TranslationAssist from './TranslationAssist.svelte';
  import ChatMessages from './ChatMessages.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import { REACTIONS } from '../../../shared/reactions.js';

  /**
   * One translation proposal. "compact" is the popover form: the new wording, votes and a link to the thread.
   * @type {{ p: import('../lib/api.js').Proposal, compact?: boolean, messages?: import('../lib/api.js').PublicMessage[] }}
   */
  let { p, compact = false, messages = [] } = $props();

  const diff = $derived(wordDiff(p.original, p.text));
  let editing = $state(false);
  let editText = $state('');
  let editNote = $state('');
  let confirm = $state(/** @type {'' | 'delete' | 'reject'} */ (''));
  let reason = $state('');

  let showDiscussion = $state(false);

  /** @param {-1 | 0 | 1} value */
  const vote = (value) => change(() => api.vote(p.id, p.votes.mine === value ? null : value));

  function startEdit() {
    editText = p.text;
    editNote = p.note ?? '';
    editing = true;
  }
  async function saveEdit() {
    const r = await change(() => api.editProposal(p.id, { text: editText, note: editNote || null }));
    if (r) editing = false;
  }
  /** @type {{ id: number, authorName: string | null, body: string } | null} */ let replyTo = $state(null);
  /** @param {string} body */
  async function sendReply(body) {
    const r = await change(() => api.postMessage(p.ref, body, p.id, replyTo?.id ?? null));
    if (r) replyTo = null;
    return !!r;
  }
</script>

<article class="proposal" class:compact data-status={p.status}>
  <header class="proposal-head">
    <span class="status-badge" data-status={p.status}>{STATUS_NAMES[p.status]}</span>
    {#if p.version > 1}<span class="muted small">версия {p.version}</span>{/if}
    <span class="spacer"></span>
    <span class="muted small">{p.authorName} · {formatTime(p.updatedAt)}</span>
  </header>

  {#if compact}
    <div class="proposal-text">{p.text}</div>
  {:else}
    <div class="proposal-diff">
      {#each diff as part, i (i)}
        {#if part.type === 'del'}<del>{part.text}</del>{:else if part.type === 'ins'}<ins>{part.text}</ins>{:else}{part.text}{/if}
      {/each}
    </div>
  {/if}
  {#if p.note && !compact}<div class="proposal-note">{p.note}</div>{/if}
  {#if !editing}
    {#each p.warnings ?? [] as w (w.kind + w.termId + w.message)}<div class="gl-warning">{w.message}</div>{/each}
  {/if}
  {#if p.decisionNote && (p.status !== 'voting')}<div class="hint">{p.decisionNote}</div>{/if}

  {#if p.status !== 'draft'}
    <div class="proposal-votes">
      <span class="small">{votingSummary(p)}</span>
      {#if p.status === 'voting' && p.closesAt}<span class="muted small"> · до {formatTime(p.closesAt)}</span>{/if}
    </div>
  {/if}
  {#if p.can.vote}
    <div class="vote-row" role="group" aria-label="Голос">
      <button class="btn vote-for" class:on={p.votes.mine === 1} onclick={() => vote(1)}>За</button>
      <button class="btn vote-against" class:on={p.votes.mine === -1} onclick={() => vote(-1)}>Против</button>
      <button class="btn" class:on={p.votes.mine === 0} onclick={() => vote(0)}>Воздерживаюсь</button>
    </div>
  {/if}

  {#if compact}
    <button class="link-btn" onclick={() => openThread(p.ref, { focus: p.id })}>Обсуждение и подробности →</button>
  {:else}
    {#if editing}
      <textarea class="text-area" bind:value={editText} rows="3" aria-label="Текст перевода"></textarea>
      <input class="text-input" bind:value={editNote} placeholder="Обоснование (необязательно)" />
      <TranslationAssist ref={p.ref} start={p.start} end={p.end} text={editText} proposalId={p.id} onpick={(t) => (editText = t)} />
      {#if p.status === 'voting'}<p class="hint">Изменение текста создаст новую версию: голоса обнулятся, срок начнётся заново.</p>{/if}
      <div class="row-end">
        <button class="btn" onclick={() => (editing = false)}>Отмена</button>
        <button class="btn primary" onclick={saveEdit} disabled={!editText.trim()}>Сохранить</button>
      </div>
    {:else}
      <div class="proposal-actions">
        {#if p.can.edit}<button class="btn" onclick={startEdit}>Изменить</button>{/if}
        {#if p.can.publish}<button class="btn primary" onclick={() => change(() => api.publishProposal(p.id))}>На голосование</button>{/if}
        {#if p.can.withdraw}<button class="btn" onclick={() => change(() => api.withdrawProposal(p.id))}>Снять с голосования</button>{/if}
        {#if p.can.delete}
          <button class="btn" class:danger-text={confirm === 'delete'} onblur={() => (confirm = '')}
            onclick={() => (confirm === 'delete' ? change(() => api.deleteProposal(p.id)) : (confirm = 'delete'))}>
            {confirm === 'delete' ? 'Точно удалить?' : 'Удалить'}
          </button>
        {/if}
        {#if p.can.moderate}
          {#if p.status === 'voting'}
            <button class="btn" onclick={() => change(() => api.moderate(p.id, 'unpublish'))} title="Вернуть автору в черновики">Снять (координатор)</button>
          {/if}
          <button class="btn" onclick={() => (confirm = confirm === 'reject' ? '' : 'reject')}>Отклонить (координатор)</button>
        {/if}
      </div>
      {#if confirm === 'reject'}
        <div class="notes-filters">
          <input class="text-input" bind:value={reason} placeholder="Причина (будет видна в ветке)" />
          <button class="btn primary" onclick={() => change(() => api.moderate(p.id, 'reject', reason)).then(() => (confirm = ''))}>Отклонить</button>
        </div>
      {/if}
      {#if p.status === 'draft' && !session.user?.isTranslator}
        <p class="hint">Черновик видите только вы. Публиковать на голосование могут переводчики — обсудите вариант в ветке абзаца.</p>
      {/if}
    {/if}

    {#if p.status !== 'draft'}
      <button class="link-btn" onclick={() => (showDiscussion = !showDiscussion)}>
        {showDiscussion ? 'Скрыть обсуждение' : `Обсуждение предложения${messages.length ? ` (${messages.length})` : ''}`}
      </button>
      {#if showDiscussion}
        <div class="tg-embed proposal-chat">
          <ChatMessages {messages} me={session.user?.id ?? null} compact reactions={REACTIONS}
            onreply={(m) => (replyTo = { id: m.id, authorName: m.authorName, body: m.body.slice(0, 200) })}
            onreact={(m, emoji) => change(() => api.react(m.id, emoji))}
            onedit={(m, body) => change(() => api.editMessage(m.id, body))}
            ondelete={(m) => change(() => api.deleteMessage(m.id))} />
          <ChatComposer onsend={sendReply} reply={replyTo} oncancelreply={() => (replyTo = null)} placeholder="Сообщение к предложению" />
        </div>
      {/if}
    {/if}
  {/if}
</article>
