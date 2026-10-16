<script>
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { thread, closeThread, change, toggleFollow, reloadThread } from '../lib/translation.svelte.js';
  import { discussInChat } from '../lib/chat.svelte.js';
  import ChatPost from './ChatPost.svelte';
  import { session } from '../lib/session.svelte.js';
  import Drawer from './Drawer.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import TranslationAssist from './TranslationAssist.svelte';
  import Icon from './Icon.svelte';

  /**
   * One paragraph's translation: proposals, voting and their history. The paragraph's discussion lives
   * in the chat (its thread there) — one place for it, the same as from the chat list.
   * @type {{ ru: string, en: string }}  plain texts of the paragraph (from the reader)
   */
  let { ru, en } = $props();

  let draftText = $state('');
  let draftNote = $state('');
  let showHistory = $state(false);

  const comments = $derived(thread.messages.filter((m) => m.proposalId === null && m.kind === 'message').length);
  function toChat() {
    const ref = thread.ref;
    closeThread();
    if (ref) discussInChat(ref);
  }
  const byProposal = $derived(Map.groupBy(thread.messages.filter((m) => m.proposalId !== null), (m) => m.proposalId));
  const active = $derived(thread.proposals.filter((p) => p.status === 'approved' || p.status === 'voting' || p.status === 'draft'));
  const history = $derived(thread.proposals.filter((p) => p.status === 'rejected' || p.status === 'superseded'));

  // A new fragment to translate: the editor starts with the original wording.
  $effect(() => {
    const c = thread.compose;
    if (c) {
      draftText = c.original;
      draftNote = '';
    }
  });
  // Scroll to a proposal opened from elsewhere.
  $effect(() => {
    const id = thread.focus;
    if (id !== null && thread.proposals.length) tick().then(() => document.getElementById(`proposal-${id}`)?.scrollIntoView({ block: 'center' }));
  });

  /** @param {boolean} publish */
  async function saveDraft(publish) {
    const c = thread.compose;
    if (!c) return;
    const created = await change(() => api.createProposal({ ref: c.ref, start: c.start, end: c.end, text: draftText, note: draftNote || undefined }));
    if (!created) return;
    if (publish) await change(() => api.publishProposal(created.id));
    thread.compose = null;
    thread.focus = created.id;
  }

  /** The original paragraph with the fragment being translated marked. */
  const marked = $derived.by(() => {
    const c = thread.compose;
    return c ? [ru.slice(0, c.start), ru.slice(c.start, c.end), ru.slice(c.end)] : null;
  });
</script>

<Drawer title="Абзац {thread.ref}" subtitle="Переводы — видят все участники платформы" wide onclose={closeThread}>
  {#snippet actions()}
    <button class="ui-chip follow-chip" class:on={thread.following} aria-pressed={thread.following} onclick={toggleFollow}
      title={thread.following
        ? 'Вы получаете уведомления о новых сообщениях и решениях в этом абзаце. Нажмите, чтобы отписаться'
        : 'Получать уведомления о новых сообщениях и решениях в этом абзаце'}>
      <Icon name={thread.following ? 'eye' : 'eye-off'} size={16} />{thread.following ? 'Вы следите' : 'Следить'}
    </button>
  {/snippet}
  <div class="thread-drawer">
    <!-- The paragraph as a channel post (the fragment being translated marked). -->
    <section class="tg-embed thread-post">
      <ChatPost ref={thread.ref ?? ''} paperId={Number((thread.ref ?? '0').split(':')[0])} {en} plain {comments}>
        {#if marked}{marked[0]}<mark>{marked[1]}</mark>{marked[2]}{:else}{ru}{/if}
      </ChatPost>
    </section>

    {#if thread.compose}
      <section class="ui-card pr-compose">
        <b class="pr-compose-title">Ваш вариант</b>
        <span class="pr-compose-of">для «{thread.compose.original.length > 80 ? thread.compose.original.slice(0, 80) + '…' : thread.compose.original}»</span>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea class="ui-input gl-area" bind:value={draftText} rows="4" autofocus aria-label="Новый вариант перевода"></textarea>
        <input class="ui-input" bind:value={draftNote} placeholder="Обоснование: почему так точнее (необязательно)" />
        <TranslationAssist ref={thread.compose.ref} start={thread.compose.start} end={thread.compose.end} text={draftText}
          onpick={(t) => (draftText = t)} />
        <div class="pr-actions">
          <button class="ui-btn" onclick={() => (thread.compose = null)}>Отмена</button>
          <button class="ui-btn" onclick={() => saveDraft(false)} disabled={!draftText.trim() || draftText === thread.compose.original}>В черновик</button>
          {#if session.user?.isTranslator}
            <button class="ui-btn primary pr-wide" onclick={() => saveDraft(true)} disabled={!draftText.trim() || draftText === thread.compose.original}>На голосование</button>
          {/if}
        </div>
        {#if !session.user?.isTranslator}<p class="ui-hint">Черновик видите только вы. Публикуют на голосование переводчики.</p>{/if}
      </section>
    {/if}

    {#if active.length}
      <section>
        <div class="ui-label">Переводы</div>
        {#each active as p (p.id)}
          <div id="proposal-{p.id}" class:focused={thread.focus === p.id}>
            <ProposalCard {p} messages={byProposal.get(p.id) ?? []} />
          </div>
        {/each}
      </section>
    {/if}
    {#if history.length}
      <button class="ui-chip pr-history" class:on={showHistory} aria-expanded={showHistory} onclick={() => (showHistory = !showHistory)}>
        <Icon name="history" size={14} />{showHistory ? 'Скрыть историю' : `История: отклонённые и заменённые · ${history.length}`}
      </button>
      {#if showHistory}
        {#each history as p (p.id)}
          <div id="proposal-{p.id}"><ProposalCard {p} messages={byProposal.get(p.id) ?? []} /></div>
        {/each}
      {/if}
    {/if}

    <!-- The discussion: the paragraph's thread in the chat -->
    <button class="ui-btn thread-to-chat" onclick={toChat}>
      <Icon name="discuss" size={18} />Обсуждение абзаца в чате{comments ? ` · ${comments}` : ''}
    </button>
  </div>
</Drawer>
