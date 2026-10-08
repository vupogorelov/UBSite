<script>
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { thread, closeThread, change, toggleFollow, reloadThread } from '../lib/translation.svelte.js';
  import { onChatEvent, sendTyping } from '../lib/chat.svelte.js';
  import { REACTIONS } from '../../../shared/reactions.js';
  import ChatMessages from './ChatMessages.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ChatPost from './ChatPost.svelte';
  import { session } from '../lib/session.svelte.js';
  import Drawer from './Drawer.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import TranslationAssist from './TranslationAssist.svelte';
  import Icon from './Icon.svelte';

  /**
   * The public thread of one paragraph: proposals and discussion.
   * @type {{ ru: string, en: string }}  plain texts of the paragraph (from the reader)
   */
  let { ru, en } = $props();

  let draftText = $state('');
  let draftNote = $state('');
  /** @type {{ id: number, authorName: string | null, body: string } | null} */ let replyTo = $state(null);
  let showHistory = $state(false);

  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  const general = $derived(thread.messages.filter((m) => m.proposalId === null));
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

  /** @param {string} body */
  async function send(body) {
    if (!thread.ref) return false;
    const ref = thread.ref;
    const to = replyTo?.id ?? null;
    const ok = await change(() => api.postMessage(ref, body, null, to));
    if (ok) replyTo = null;
    return !!ok;
  }
  // New messages, reactions and edits by others arrive live.
  (() => {
    const ref = thread.ref;
    if (!ref) return;
    let timer = 0;
    return onChatEvent((e) => {
      if (e.key !== ref || e.type === 'typing') return;
      clearTimeout(timer);
      timer = window.setTimeout(() => void reloadThread(), 150);
    });
  });

  /** The original paragraph with the fragment being translated marked. */
  const marked = $derived.by(() => {
    const c = thread.compose;
    return c ? [ru.slice(0, c.start), ru.slice(c.start, c.end), ru.slice(c.end)] : null;
  });
</script>

<Drawer title="Абзац {thread.ref}" subtitle="Публичное обсуждение и переводы — видят все участники платформы" wide onclose={closeThread}>
  {#snippet actions()}
    <button class="btn follow-btn" class:on={thread.following} onclick={toggleFollow}
      title={thread.following
        ? 'Вы получаете уведомления о новых сообщениях и решениях в этом абзаце. Нажмите, чтобы отписаться'
        : 'Получать уведомления о новых сообщениях и решениях в этом абзаце'}>
      <Icon name={thread.following ? 'eye' : 'eye-off'} size={16} />{thread.following ? 'Вы следите' : 'Следить'}
    </button>
  {/snippet}
  <div class="thread-drawer">
    <!-- The paragraph as a channel post; its discussion below reads as the post's comments. -->
    <section class="tg-embed thread-post">
      <ChatPost ref={thread.ref ?? ''} paperId={Number((thread.ref ?? '0').split(':')[0])} {en} plain
        comments={general.filter((m) => m.kind === 'message').length}>
        {#if marked}{marked[0]}<mark>{marked[1]}</mark>{marked[2]}{:else}{ru}{/if}
      </ChatPost>
    </section>

    {#if thread.compose}
      <section class="group compose">
        <div class="box-title">Ваш вариант для «{thread.compose.original.length > 60 ? thread.compose.original.slice(0, 60) + '…' : thread.compose.original}»</div>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea class="text-area" bind:value={draftText} rows="4" autofocus aria-label="Новый вариант перевода"></textarea>
        <input class="text-input" bind:value={draftNote} placeholder="Обоснование: почему так точнее (необязательно)" />
        <TranslationAssist ref={thread.compose.ref} start={thread.compose.start} end={thread.compose.end} text={draftText}
          onpick={(t) => (draftText = t)} />
        <div class="row-end">
          <button class="btn" onclick={() => (thread.compose = null)}>Отмена</button>
          <button class="btn" onclick={() => saveDraft(false)} disabled={!draftText.trim() || draftText === thread.compose.original}>Сохранить черновик</button>
          {#if session.user?.isTranslator}
            <button class="btn primary" onclick={() => saveDraft(true)} disabled={!draftText.trim() || draftText === thread.compose.original}>На голосование</button>
          {/if}
        </div>
        {#if !session.user?.isTranslator}<p class="hint">Черновик видите только вы. Публикуют на голосование переводчики.</p>{/if}
      </section>
    {/if}

    {#if active.length}
      <section>
        <div class="box-title">Переводы</div>
        {#each active as p (p.id)}
          <div id="proposal-{p.id}" class:focused={thread.focus === p.id}>
            <ProposalCard {p} messages={byProposal.get(p.id) ?? []} />
          </div>
        {/each}
      </section>
    {/if}
    {#if history.length}
      <button class="link-btn" onclick={() => (showHistory = !showHistory)}>
        {showHistory ? 'Скрыть историю' : `История: отклонённые и заменённые (${history.length})`}
      </button>
      {#if showHistory}
        {#each history as p (p.id)}
          <div id="proposal-{p.id}"><ProposalCard {p} messages={byProposal.get(p.id) ?? []} /></div>
        {/each}
      {/if}
    {/if}

    <section>
      <div class="box-title">Обсуждение абзаца</div>
      <div class="tg-embed thread-chat">
        {#if !general.length && !thread.loading}<div class="tg-service"><span>Пока никто не писал — начните обсуждение</span></div>{/if}
        <ChatMessages messages={general} me={session.user?.id ?? null} reactions={REACTIONS}
          onreply={(m) => (replyTo = { id: m.id, authorName: m.authorName, body: m.body.slice(0, 200) })}
          onreact={(m, emoji) => change(() => api.react(m.id, emoji))}
          onedit={(m, body) => change(() => api.editMessage(m.id, body))}
          ondelete={(m) => change(() => api.deleteMessage(m.id))}
          onhide={(m) => change(() => api.hideMessage(m.id, !m.hiddenAt))} canhide={coordinator} />
        <ChatComposer onsend={send} reply={replyTo} oncancelreply={() => (replyTo = null)}
          ontyping={() => thread.ref && sendTyping(thread.ref)} placeholder="Сообщение в обсуждение абзаца" />
      </div>
    </section>
  </div>
</Drawer>
