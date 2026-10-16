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
  import Icon from './Icon.svelte';

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
  let replyTo = $state(/** @type {{ id: number, authorName: string | null, body: string } | null} */ (null));
  /** @param {string} body */
  async function sendReply(body) {
    const r = await change(() => api.postMessage(p.ref, body, p.id, replyTo?.id ?? null));
    if (r) replyTo = null;
    return !!r;
  }
</script>

<article class="proposal" class:compact data-status={p.status}>
  <header class="proposal-head">
    <span class="status-badge tr-status" data-status={p.status}>{STATUS_NAMES[p.status]}</span>
    {#if p.version > 1}<span class="pr-meta">версия {p.version}</span>{/if}
    <span class="spacer"></span>
    <span class="pr-meta pr-author">{p.authorName} · {formatTime(p.updatedAt)}</span>
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
  {#if p.decisionNote && (p.status !== 'voting')}<div class="pr-decision">{p.decisionNote}</div>{/if}

  {#if p.status !== 'draft'}
    <div class="proposal-votes">
      <span class="small">{votingSummary(p)}</span>
      {#if p.status === 'voting' && p.closesAt}<span class="muted small"> · до {formatTime(p.closesAt)}</span>{/if}
    </div>
  {/if}
  {#if p.can.vote}
    <!-- the vote: three pills, the chosen one filled (again — the vote is taken back) -->
    <div class="vote-row" role="group" aria-label="Голос">
      <button class="vote-pill vote-for" class:on={p.votes.mine === 1} aria-pressed={p.votes.mine === 1} onclick={() => vote(1)}>За</button>
      <button class="vote-pill vote-against" class:on={p.votes.mine === -1} aria-pressed={p.votes.mine === -1} onclick={() => vote(-1)}>Против</button>
      <button class="vote-pill" class:on={p.votes.mine === 0} aria-pressed={p.votes.mine === 0} onclick={() => vote(0)}>Воздерживаюсь</button>
    </div>
  {/if}

  {#if compact}
    <button class="ui-chip pr-chip" onclick={() => openThread(p.ref, { focus: p.id })}><Icon name="discuss" size={14} />Обсуждение и подробности</button>
  {:else}
    {#if editing}
      <textarea class="ui-input gl-area" bind:value={editText} rows="3" aria-label="Текст перевода"></textarea>
      <input class="ui-input" bind:value={editNote} placeholder="Обоснование (необязательно)" />
      <TranslationAssist ref={p.ref} start={p.start} end={p.end} text={editText} proposalId={p.id} onpick={(t) => (editText = t)} />
      {#if p.status === 'voting'}<p class="ui-hint">Изменение текста создаст новую версию: голоса обнулятся, срок начнётся заново.</p>{/if}
      <div class="pr-actions">
        <button class="ui-btn" onclick={() => (editing = false)}>Отмена</button>
        <button class="ui-btn primary" onclick={saveEdit} disabled={!editText.trim()}>Сохранить</button>
      </div>
    {:else}
      {#if p.can.edit || p.can.publish || p.can.withdraw || p.can.delete}
        <div class="pr-actions">
          {#if p.can.edit}<button class="ui-btn" onclick={startEdit}>Изменить</button>{/if}
          {#if p.can.publish}<button class="ui-btn primary" onclick={() => change(() => api.publishProposal(p.id))}>На голосование</button>{/if}
          {#if p.can.withdraw}<button class="ui-btn" onclick={() => change(() => api.withdrawProposal(p.id))}>Снять с голосования</button>{/if}
          {#if p.can.delete}
            <button class="ui-round pr-delete" class:danger={confirm === 'delete'} onblur={() => (confirm = '')}
              aria-label={confirm === 'delete' ? 'Точно удалить?' : 'Удалить'} title={confirm === 'delete' ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить'}
              onclick={() => (confirm === 'delete' ? change(() => api.deleteProposal(p.id)) : (confirm = 'delete'))}><Icon name="trash" size={18} /></button>
          {/if}
        </div>
        {#if confirm === 'delete'}<p class="ui-hint pr-confirm">Нажмите ещё раз, чтобы удалить.</p>{/if}
      {/if}
      {#if p.can.moderate}
        <!-- the coordinator's own actions: quieter, apart from the author's -->
        <div class="pr-coord">
          <span>Координатор</span>
          {#if p.status === 'voting'}
            <button class="ui-chip" onclick={() => change(() => api.moderate(p.id, 'unpublish'))} title="Вернуть автору в черновики">Снять</button>
          {/if}
          <button class="ui-chip" class:on={confirm === 'reject'} onclick={() => (confirm = confirm === 'reject' ? '' : 'reject')}>Отклонить</button>
        </div>
      {/if}
      {#if confirm === 'reject'}
        <div class="pr-reject">
          <input class="ui-input" bind:value={reason} placeholder="Причина (будет видна в ветке)" />
          <button class="ui-btn primary" onclick={() => change(() => api.moderate(p.id, 'reject', reason)).then(() => (confirm = ''))}>Отклонить</button>
        </div>
      {/if}
      {#if p.status === 'draft' && !session.user?.isTranslator}
        <p class="ui-hint">Черновик видите только вы. Публиковать на голосование могут переводчики — обсудите вариант в ветке абзаца.</p>
      {/if}
    {/if}

    {#if p.status !== 'draft'}
      <button class="ui-chip pr-chip" class:on={showDiscussion} aria-expanded={showDiscussion} onclick={() => (showDiscussion = !showDiscussion)}>
        <Icon name="discuss" size={14} />{showDiscussion ? 'Скрыть обсуждение' : `Обсуждение предложения${messages.length ? ` · ${messages.length}` : ''}`}
      </button>
      {#if showDiscussion}
        <div class="tg-embed proposal-chat">
          <ChatMessages {messages} me={session.user?.id ?? null} compact reactions={REACTIONS} chatKey={p.ref}
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
