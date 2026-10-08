<script>
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { chat, onChatEvent, markRead, sendTyping } from '../lib/chat.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { REACTIONS } from '../../../shared/reactions.js';
  import Icon from './Icon.svelte';
  import ChatMessages from './ChatMessages.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ChatPost from './ChatPost.svelte';
  import ChatAvatar from './ChatAvatar.svelte';
  import { visibility } from '../lib/visibility.js';

  /** One conversation of the chat page. @type {{ key: string, onback?: () => void }} */
  let { key, onback } = $props();

  /** @type {import('../lib/api.js').ChatInfo | null} */ let info = $state(null);
  /** @type {import('../lib/api.js').PublicMessage[]} */ let messages = $state([]);
  let hasMore = $state(true);
  let loadingOlder = false;
  /** @type {number | null} */ let unreadAfter = $state(null);
  /** @type {{ id: number, authorName: string | null, body: string } | null} */ let reply = $state(null);
  /** @type {HTMLElement | undefined} */ let scroller = $state();
  /** @type {ChatMessages | undefined} */ let list = $state();
  let atBottom = $state(true);
  let newBelow = $state(0);

  const me = $derived(session.user?.id ?? null);
  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));

  $effect(() => {
    const k = key;
    chat.active = k;
    info = null;
    messages = [];
    reply = null;
    hasMore = true;
    newBelow = 0;
    void open(k);
    const off = onChatEvent((e) => e.key === k && onEvent(e));
    return () => {
      off();
      if (chat.active === k) chat.active = null;
    };
  });

  /** @param {string} k */
  async function open(k) {
    try {
      const [i, list] = await Promise.all([api.chatInfo(k), api.chatMessages(k)]);
      if (k !== key) return;
      info = i;
      messages = list;
      hasMore = list.length >= 60;
      // Where the unread part begins: after the reader's last read (taken from the chat list).
      const n = chat.list.find((c) => c.key === k)?.unread ?? 0;
      const others = list.filter((m) => m.authorId !== me && m.kind === 'message');
      unreadAfter = n > 0 && others.length >= n ? others[others.length - n].id - 1 : null;
      await tick();
      const divider = scroller?.querySelector('.tg-unread');
      if (divider) divider.scrollIntoView({ block: 'center' });
      else scrollToBottom();
      readIfAtBottom();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }

  function scrollToBottom() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    newBelow = 0;
  }
  function readIfAtBottom() {
    const last = messages.at(-1);
    if (atBottom && last && document.visibilityState === 'visible') markRead(key, last.id);
  }
  async function onScroll() {
    if (!scroller) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    if (atBottom) {
      newBelow = 0;
      readIfAtBottom();
    }
    if (scroller.scrollTop < 120 && hasMore && !loadingOlder && messages.length) {
      loadingOlder = true;
      const k = key;
      const before = scroller.scrollHeight;
      const older = await api.chatMessages(k, messages[0].id).catch(() => []);
      if (k === key) {
        messages = [...older, ...messages];
        hasMore = older.length >= 60;
        await tick();
        scroller.scrollTop += scroller.scrollHeight - before; // keep the view where it was
      }
      loadingOlder = false;
    }
  }

  /** @param {import('../lib/chat.svelte.js').ChatEvent} e */
  async function onEvent(e) {
    if (e.type === 'message') {
      if (messages.some((m) => m.id === e.message.id)) return;
      const stick = atBottom || e.message.authorId === me;
      messages = [...messages, e.message];
      await tick();
      if (stick) {
        scrollToBottom();
        readIfAtBottom();
      } else newBelow++;
    } else if (e.type === 'edit') {
      messages = messages.map((m) => (m.id === e.id ? { ...m, body: e.body, updatedAt: e.updatedAt } : m));
    } else if (e.type === 'delete') {
      messages = messages.filter((m) => m.id !== e.id);
    } else if (e.type === 'reactions') {
      const mine = (/** @type {any} */ r) => String(r.userIds ?? '').split(',').map(Number).includes(me ?? -1);
      messages = messages.map((m) => (m.id === e.id ? { ...m, reactions: e.reactions.map((/** @type {any} */ r) => ({ ...r, mine: mine(r) })) } : m));
    } else if (e.type === 'reload') {
      const fresh = await api.chatMessages(key).catch(() => null);
      if (fresh) messages = fresh;
    }
  }

  /** @param {string} body */
  async function send(body) {
    try {
      const m = await api.chatPost(key, body, reply?.id ?? null);
      reply = null;
      if (!messages.some((x) => x.id === m.id)) messages = [...messages, m];
      await tick();
      scrollToBottom();
      return true;
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
      return false;
    }
  }
  /** @param {any} m @param {string} emoji */
  async function react(m, emoji) {
    try {
      const { reactions } = await api.react(m.id, emoji);
      messages = messages.map((x) => (x.id === m.id ? { ...x, reactions } : x));
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
  /** @param {any} m @param {string} body */
  async function edit(m, body) {
    try {
      await api.editMessage(m.id, body);
      messages = messages.map((x) => (x.id === m.id ? { ...x, body, updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') } : x));
      return true;
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
      return false;
    }
  }
  /** @param {any} m */
  async function remove(m) {
    try {
      await api.deleteMessage(m.id);
      messages = messages.filter((x) => x.id !== m.id);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
  /** @param {any} m */
  async function hide(m) {
    try {
      await api.hideMessage(m.id, !m.hiddenAt);
      messages = (await api.chatMessages(key)) ?? messages;
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }

  const typing = $derived(chat.typing[key]);
  /** Who can read this chat: under its title, before the paper's or channel's description. */
  const vis = $derived(info ? visibility(info) : null);
</script>

<section class="tg-chat">
  <header class="tg-chat-head">
    {#if onback}<button class="icon-btn small-btn tg-back" onclick={onback} aria-label="К списку чатов"><Icon name="back" /></button>{/if}
    <ChatAvatar chat={info} />
    <div class="tg-chat-title">
      <b>{info?.title ?? '…'}</b>
      {#if typing}<span class="tg-typing">{typing.name} печатает<span class="tg-dots"><i></i><i></i><i></i></span></span>
      {:else if vis}<span class="muted tg-vis-line"><span class="tg-vis" title={vis.full}><Icon name={vis.icon} size={13} />{vis.short}</span>{#if info?.kind !== 'ws' && info?.subtitle}<span class="ellipsis">· {info.subtitle}</span>{/if}</span>{/if}
    </div>
    <span class="spacer"></span>
    {#if info?.kind === 'para'}
      <button class="btn" onclick={() => navigate(`/${key}`)}><Icon name="book-open" size={16} />Открыть в книге</button>
    {/if}
  </header>
  <div class="tg-scroll" bind:this={scroller} onscroll={onScroll}>
    <!-- The conversation is as wide as the book's column (the reader's "Ширина колонки"). -->
    <div class="tg-column">
      {#if info?.kind === 'para' && info.post && !hasMore}
        <!-- A paragraph thread starts with the paragraph itself, as a channel post; messages are its comments. -->
        <ChatPost ref={key} paperId={info.post.paperId} paperTitle={info.post.paperTitle} pageRef={info.post.pageRef}
          ru={info.post.ru} en={info.post.en} comments={messages.filter((m) => m.kind === 'message').length} />
        {#if messages.length}<div class="tg-service"><span>Обсуждение</span></div>{/if}
      {:else if !hasMore && messages.length}
        <div class="tg-service"><span>Начало переписки</span></div>
      {/if}
      {#if info && !messages.length}<div class="tg-empty" class:after-post={info.kind === 'para'}><span>Сообщений пока нет — напишите первое.</span></div>{/if}
      <ChatMessages bind:this={list} {messages} {me} {unreadAfter} reactions={REACTIONS}
        onreply={(m) => (reply = { id: m.id, authorName: m.authorName, body: m.body.slice(0, 200) })}
        onreact={react} onedit={edit} ondelete={remove} onhide={hide} canhide={coordinator && info?.kind !== 'ws'} />
    </div>
  </div>
  {#if newBelow}
    <button class="tg-down" onclick={scrollToBottom} aria-label="К новым сообщениям"><Icon name="down" /><span>{newBelow}</span></button>
  {/if}
  {#if info?.archived}
    <div class="tg-archived muted">Канал в архиве — только чтение</div>
  {:else}
    <ChatComposer onsend={send} {reply} oncancelreply={() => (reply = null)} ontyping={() => sendTyping(key)} />
  {/if}
</section>
