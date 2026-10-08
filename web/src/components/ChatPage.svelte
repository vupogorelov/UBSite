<script>
  import { api } from '../lib/api.js';
  import { chat, chatUi, loadChats } from '../lib/chat.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { navigate, route, lastPath, onBack } from '../lib/router.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Icon from './Icon.svelte';
  import ChatConversation from './ChatConversation.svelte';
  import ChatAvatar from './ChatAvatar.svelte';

  /** The chat page (/chat?c=<key>), laid out like Telegram Desktop: the chat list and the conversation. */

  let query = $state('');
  let active = $state(/** @type {string | null} */ (null));
  $effect(() => {
    void route.nav;
    active = new URLSearchParams(location.search).get('c');
    void loadChats();
  });
  function backToList() {
    active = null;
    navigate('/chat', { replace: true });
  }
  // Phone: an open conversation takes the whole screen — "back" returns to the chat list.
  $effect(() => {
    if (device.mobile && active) return onBack(backToList);
  });

  /** @param {string} key */
  function select(key) {
    active = key;
    navigate(`/chat?c=${encodeURIComponent(key)}`, { replace: true });
  }

  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? chat.list.filter((c) => `${c.title} ${c.subtitle ?? ''} ${c.last?.body ?? ''}`.toLowerCase().includes(q)) : chat.list;
  });

  const toDate = (/** @type {string} */ s) => new Date(s.replace(' ', 'T') + 'Z');
  /** "14:05" today, "пн" this week, "06.10.26" otherwise — as Telegram. @param {string} s */
  function when(s) {
    const d = toDate(s);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('ru', { weekday: 'short' });
    return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  // ---- The search field: always there on a computer; on the phone it opens from the header ----
  /** @type {HTMLInputElement | undefined} */ let searchInput = $state();
  const searchShown = $derived(!device.mobile || chatUi.search);
  $effect(() => {
    if (device.mobile && chatUi.search) searchInput?.focus();
  });
  $effect(() => {
    if (!chatUi.search) query = '';
  });
  // Phone: "back" closes the search first (an open conversation is handled above).
  $effect(() => {
    if (device.mobile && chatUi.search && !active) return onBack(() => void (chatUi.search = false));
  });
  $effect(() => () => {
    chatUi.search = false;
    chatUi.creating = false;
  });

  // ---- The hint under the list: can be closed for good ----
  const HINT_KEY = 'ub.chatHintClosed';
  let hintClosed = $state((() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return false;
    }
  })());
  function closeHint() {
    hintClosed = true;
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {}
  }

  // ---- A new channel (coordinators) ----
  let chTitle = $state('');
  let chDesc = $state('');
  async function createChannel() {
    if (!chTitle.trim()) return;
    try {
      const { id } = await api.createChannel(chTitle.trim(), chDesc.trim() || null);
      chatUi.creating = false;
      chTitle = chDesc = '';
      await loadChats();
      select(`chan:${id}`);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
</script>

<div class="tg-page" class:has-active={active !== null}>
  <aside class="tg-list">
    {#if searchShown}
    <div class="tg-list-head">
      <button class="icon-btn small-btn" onclick={() => navigate(lastPath())} title="К книге" aria-label="К книге"><Icon name="back" /></button>
      <label class="tg-search">
        <Icon name="search" size={16} />
        <input bind:this={searchInput} bind:value={query} placeholder="Поиск" aria-label="Поиск по чатам" />
      </label>
      {#if coordinator && !device.mobile}
        <button class="icon-btn small-btn" onclick={() => (chatUi.creating = !chatUi.creating)} title="Новый канал" aria-label="Новый канал"><Icon name="plus" /></button>
      {/if}
    </div>
    {/if}
    {#if chatUi.creating}
      <form class="tg-new-channel" onsubmit={(e) => (e.preventDefault(), createChannel())}>
        <input class="text-input" bind:value={chTitle} placeholder="Название канала" aria-label="Название канала" />
        <input class="text-input" bind:value={chDesc} placeholder="Описание (необязательно)" aria-label="Описание канала" />
        <div class="row-end">
          <button type="button" class="btn" onclick={() => (chatUi.creating = false)}>Отмена</button>
          <button class="btn primary" disabled={!chTitle.trim()}>Создать</button>
        </div>
      </form>
    {/if}
    <ol class="tg-chats">
      {#each shown as c (c.key)}
        <li>
          <button class="tg-chat-item" class:active={active === c.key} onclick={() => select(c.key)}>
            <ChatAvatar chat={c} />
            <span class="tg-chat-main">
              <span class="tg-chat-line">
                <b class="ellipsis">{c.title}</b>
                {#if c.last}<span class="tg-chat-time">{when(c.last.createdAt)}</span>{/if}
              </span>
              <span class="tg-chat-line">
                <span class="tg-chat-preview ellipsis">
                  {#if chat.typing[c.key]}<span class="tg-typing">{chat.typing[c.key].name} печатает…</span>
                  {:else if c.last}
                    {#if c.last.kind === 'event'}<i>{c.last.body}</i>
                    {:else}<span class="tg-chat-author">{c.last.authorId === session.user?.id ? 'Вы' : c.last.authorName ?? ''}:</span> {c.last.body}{/if}
                  {:else}<span class="muted">{c.subtitle ?? 'Нет сообщений'}</span>{/if}
                </span>
                {#if c.mentions}<span class="tg-badge mention">@</span>{/if}
                {#if c.unread}<span class="tg-badge">{c.unread > 999 ? '999+' : c.unread}</span>{/if}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ol>
    {#if chat.loaded && !chat.list.length}<p class="muted small pad">Чатов пока нет.</p>{/if}
    {#if !hintClosed}
      <p class="tg-list-hint muted small">
        <span>Ветки абзацев появляются здесь, когда вы пишете в них, предлагаете перевод, голосуете или нажимаете «Следить».</span>
        <button class="icon-btn small-btn" onclick={closeHint} title="Скрыть подсказку" aria-label="Скрыть подсказку"><Icon name="close" size={14} /></button>
      </p>
    {/if}
  </aside>
  <main class="tg-main">
    {#if active}
      {#key active}<ChatConversation key={active} onback={backToList} />{/key}
    {:else}
      <div class="tg-placeholder"><span>Выберите чат</span></div>
    {/if}
  </main>
</div>
