<script>
  import { api } from '../lib/api.js';
  import { chat, chatUi, loadChats, setPinnedChats, MAX_PINNED, plainBody, onChatEvent, muteChat } from '../lib/chat.svelte.js';
  import { MARKS } from '../lib/marks.js';
  import { session } from '../lib/session.svelte.js';
  import { navigate, back, route, lastPath, onBack } from '../lib/router.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Icon from './Icon.svelte';
  import ChatConversation from './ChatConversation.svelte';
  import ChatAvatar from './ChatAvatar.svelte';

  /**
   * The chat page (/chat?c=<key>[&m=<message id>]), laid out like Telegram Desktop: the chat list and
   * the conversation (`m`: opened at that message, e.g. from a task made of it).
   */

  let query = $state('');
  let active = $state(/** @type {string | null} */ (null));
  let focusId = $state(/** @type {number | null} */ (null));
  $effect(() => {
    void route.nav;
    const params = new URLSearchParams(location.search);
    active = params.get('c');
    focusId = Number(params.get('m')) || null;
    void loadChats();
  });
  /** The arrow of an open conversation (phone): the step back — to the list (or the list, if opened by a link). */
  function backToList() {
    active = null;
    back('/chat');
  }

  /**
   * A conversation from the list is a step ("back" returns to the list); switching between
   * conversations (the computer's two panes) is not.
   * @param {string} key
   */
  function select(key) {
    const path = `/chat?c=${encodeURIComponent(key)}`;
    navigate(path, { replace: active !== null });
    active = key;
  }

  const coordinator = $derived(Boolean(session.user?.isCoordinator || session.user?.isAdmin));
  const admin = $derived(Boolean(session.user?.isAdmin));

  // ---- The administrator's marks (take / work / done): the marked messages of all chats ----
  let markFilter = $state(/** @type {import('../lib/api.js').Mark | null} */ (null));
  /** @type {import('../lib/api.js').PublicMessage[]} */ let marked = $state([]);
  let markedLoaded = $state(false);
  async function loadMarked() {
    const mk = markFilter;
    if (!mk) return;
    const list = await api.markedMessages(mk).catch(() => []);
    if (mk === markFilter) ((marked = list), (markedLoaded = true));
  }
  $effect(() => {
    if (!markFilter) return;
    markedLoaded = false;
    marked = [];
    void loadMarked();
    return onChatEvent((e) => e.type === 'mark' && void loadMarked());
  });
  /** A found message: its chat, at it. @param {import('../lib/api.js').PublicMessage} m */
  function openMarked(m) {
    const chatKey = /** @type {string} */ (m.chat);
    navigate(`/chat?c=${encodeURIComponent(chatKey)}&m=${m.id}`, { replace: active !== null });
    active = chatKey;
  }
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

  // ---- Pinned chats: each user's own, up to 10, at the top in their order ----
  const pinnedKeys = $derived(chat.list.filter((c) => c.pinned !== null).map((c) => c.key));
  /** The chat's menu: right click; on a touch screen a long press. */
  let menu = $state(/** @type {{ key: string, x: number, y: number } | null} */ (null));
  /** @param {string} key @param {number} x @param {number} y */
  function openMenu(key, x, y) {
    menu = { key, x: Math.min(x, innerWidth - 230), y: Math.min(y, innerHeight - 80) };
  }
  /** @param {string} key */
  async function togglePin(key) {
    menu = null;
    const keys = pinnedKeys.includes(key) ? pinnedKeys.filter((k) => k !== key) : [...pinnedKeys, key];
    if (keys.length > MAX_PINNED) return showToast(`Закрепить можно до ${MAX_PINNED} чатов — сначала открепите какой-нибудь`);
    try {
      await setPinnedChats(keys);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }

  /**
   * Reordering the pinned chats by dragging: with the mouse — press and move; on a touch screen — a long
   * press, then move (a long press without moving opens the menu, like Telegram). Not while searching.
   * @type {{ key: string, from: number, to: number, dy: number, h: number } | null}
   */
  let drag = $state(null);
  /** @type {{ key: string, x: number, y: number, held: boolean, timer: number, el: HTMLElement } | null} */
  let press = null;
  let pointer = '';
  let swallowClick = false;
  /** @param {string} key @param {HTMLElement} el */
  function beginDrag(key, el) {
    const from = pinnedKeys.indexOf(key);
    drag = { key, from, to: from, dy: 0, h: el.offsetHeight };
    menu = null;
  }
  /** @param {number} dy */
  function moveDrag(dy) {
    if (!drag) return;
    drag.dy = dy;
    drag.to = Math.max(0, Math.min(pinnedKeys.length - 1, drag.from + Math.round(dy / drag.h)));
  }
  function endDrag() {
    if (!drag) return;
    const { key, from, to } = drag;
    drag = null;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 400);
    if (to === from) return;
    const keys = pinnedKeys.filter((k) => k !== key);
    keys.splice(to, 0, key);
    setPinnedChats(keys).catch((err) => showToast(err.message));
  }
  /** Where a pinned chat goes while another is dragged. @param {string} key */
  function shift(key) {
    if (!drag) return '';
    if (key === drag.key) return `translateY(${drag.dy}px)`;
    const i = pinnedKeys.indexOf(key);
    if (i < 0) return '';
    if (drag.from < i && i <= drag.to) return `translateY(${-drag.h}px)`;
    if (drag.to <= i && i < drag.from) return `translateY(${drag.h}px)`;
    return '';
  }
  const canDrag = (/** @type {import('../lib/api.js').ChatSummary} */ c) => c.pinned !== null && !query.trim() && pinnedKeys.length > 1;

  /** @param {TouchEvent} e @param {import('../lib/api.js').ChatSummary} c */
  function touchStart(e, c) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    const p = { key: c.key, x: t.clientX, y: t.clientY, held: false, timer: 0, el };
    p.timer = window.setTimeout(() => {
      p.held = true;
      navigator.vibrate?.(10);
      if (!canDrag(c)) openMenu(c.key, p.x, p.y); // nothing to drag: the menu at once
    }, 450);
    press = p;
  }
  /** @param {TouchEvent} e @param {import('../lib/api.js').ChatSummary} c */
  function touchMove(e, c) {
    if (!press) return;
    const t = e.touches[0];
    const dy = t.clientY - press.y;
    if (!press.held) {
      if (Math.hypot(t.clientX - press.x, dy) > 8) {
        clearTimeout(press.timer); // a scroll
        press = null;
      }
      return;
    }
    e.preventDefault(); // held: the finger moves the chat, not the list
    if (!drag && canDrag(c) && Math.abs(dy) > 6) beginDrag(c.key, press.el);
    moveDrag(dy);
  }
  /**
   * touchmove that may stop the list's scroll (Svelte's own `ontouchmove` is passive).
   * @param {HTMLElement} node @param {import('../lib/api.js').ChatSummary} chatItem
   */
  function heldMove(node, chatItem) {
    let c = chatItem;
    const h = (/** @type {TouchEvent} */ e) => touchMove(e, c);
    node.addEventListener('touchmove', h, { passive: false });
    return {
      /** @param {import('../lib/api.js').ChatSummary} next */
      update: (next) => void (c = next),
      destroy: () => node.removeEventListener('touchmove', h),
    };
  }
  /** @param {TouchEvent} e @param {import('../lib/api.js').ChatSummary} c */
  function touchEnd(e, c) {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.held && e.cancelable) e.preventDefault(); // no click after it: it would close the menu or open the chat
    if (drag) endDrag();
    else if (press.held) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 400);
      if (canDrag(c)) openMenu(c.key, press.x, press.y);
    }
    press = null;
  }
  /** @param {PointerEvent} e @param {import('../lib/api.js').ChatSummary} c */
  function pointerDown(e, c) {
    pointer = e.pointerType;
    if (e.pointerType !== 'mouse' || e.button !== 0 || !canDrag(c)) return;
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    const y0 = e.clientY;
    const move = (/** @type {PointerEvent} */ m) => {
      if (!drag && Math.abs(m.clientY - y0) > 5) beginDrag(c.key, el);
      moveDrag(m.clientY - y0);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      endDrag();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // ---- The search field: always there on a computer; on the phone it opens from the header ----
  /** @type {HTMLInputElement | undefined} */ let searchInput = $state();
  // (the phone: hidden until the header's magnifier — or while a query or a mark filter is set)
  const searchShown = $derived(!device.mobile || chatUi.search || !!query || markFilter !== null);
  /** The search field is in use: the administrator's marks' filter shows under it. */
  let searchFocus = $state(false);
  const marksShown = $derived(!device.mobile || searchFocus || !!query || markFilter !== null || chatUi.search);
  $effect(() => {
    if (device.mobile && chatUi.search) searchInput?.focus();
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

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === 'Escape' && (menu = null)} />

<div class="tg-page" class:has-active={active !== null}>
  <aside class="tg-list">
    {#if searchShown}
    <div class="tg-list-head">
      <button class="icon-btn small-btn" onclick={() => navigate(lastPath(), { root: true })} title="К книге" aria-label="К книге"><Icon name="back" /></button>
      <label class="tg-search" onfocusin={() => (searchFocus = true)} onfocusout={() => setTimeout(() => (searchFocus = false), 150)}>
        <Icon name="search" size={18} />
        <input bind:this={searchInput} bind:value={query} placeholder="Поиск по чатам" aria-label="Поиск по чатам" />
        {#if query || markFilter}<button class="ui-search-clear" onclick={(e) => (e.preventDefault(), (query = ''), (markFilter = null))} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
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
    {#if admin && marksShown}
      <!-- The administrator's marks: a tap shows the marked messages of all chats instead of the list -->
      <div class="tg-mark-filter" role="group" aria-label="Отмеченные сообщения">
        {#each MARKS as [mk, label] (mk)}
          <button class="tg-mark" data-mark={mk} class:on={markFilter === mk} aria-pressed={markFilter === mk} title={label}
            onclick={() => (markFilter = markFilter === mk ? null : mk)}>{mk}</button>
        {/each}
      </div>
    {/if}
    {#if markFilter}
      <ol class="tg-marked">
        {#each marked as m (m.id)}
          <li>
            <button class="tg-marked-item" class:active={active === m.chat} onclick={() => openMarked(m)}>
              <span class="tg-chat-line">
                <b class="ellipsis">{m.chatTitle}</b>
                <span class="tg-chat-time">{when(m.createdAt)}</span>
              </span>
              <span class="tg-marked-body"><span class="tg-chat-author">{m.authorName ?? 'Участник'}:</span> {plainBody(m.body)}</span>
            </button>
          </li>
        {:else}
          <li class="muted small tg-marked-empty">{markedLoaded ? 'Нет сообщений с этой отметкой.' : 'Загрузка…'}</li>
        {/each}
      </ol>
    {:else}
    <ol class="tg-chats">
      {#each shown as c (c.key)}
        <li>
          <button class="tg-chat-item" class:active={active === c.key} class:dragging={drag?.key === c.key} class:shifting={!!drag && drag.key !== c.key}
            style:transform={shift(c.key)}
            onclick={() => !swallowClick && select(c.key)}
            oncontextmenu={(e) => (e.preventDefault(), pointer !== 'touch' && openMenu(c.key, e.clientX, e.clientY))}
            onpointerdown={(e) => pointerDown(e, c)}
            ontouchstart={(e) => touchStart(e, c)} use:heldMove={c} ontouchend={(e) => touchEnd(e, c)} ontouchcancel={(e) => touchEnd(e, c)}>
            <ChatAvatar chat={c} />
            <span class="tg-chat-main">
              <span class="tg-chat-line">
                <b class="ellipsis">{#if c.voice}<span class="tg-chan-mark" title="Канал" role="img" aria-label="Канал:"><Icon name="megaphone" size={14} /></span>{/if}{c.title}</b>
                {#if c.last}<span class="tg-chat-time">{when(c.last.createdAt)}</span>{/if}
              </span>
              <span class="tg-chat-line">
                <span class="tg-chat-preview ellipsis">
                  {#if chat.typing[c.key]}<span class="tg-typing">{chat.typing[c.key].name} печатает…</span>
                  {:else if c.last}
                    {#if c.last.kind === 'event'}<i>{c.last.body}</i>
                    {:else}<span class="tg-chat-author">{c.last.authorId === session.user?.id ? 'Вы' : c.last.authorName ?? ''}:</span> {plainBody(c.last.body)}{/if}
                  {:else}<span class="muted">{c.subtitle ?? 'Нет сообщений'}</span>{/if}
                </span>
                {#if c.mentions}<span class="tg-badge mention">@</span>{/if}
                {#if c.unread}<span class="tg-badge" class:muted={c.muted} title={c.muted ? 'Без звука — не входит в общий счётчик' : null}>{c.unread > 999 ? '999+' : c.unread}</span>
                {:else if c.pinned !== null}<span class="tg-chat-pin" title="Закреплён"><Icon name="pin" size={14} /></span>{/if}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ol>
    {/if}
    {#if chat.loaded && !chat.list.length}<p class="muted small pad">Чатов пока нет.</p>{/if}
    {#if !hintClosed && !markFilter}
      <p class="tg-list-hint">
        <span>Ветки абзацев появляются здесь, когда вы пишете в них, предлагаете перевод, голосуете или нажимаете «Следить».</span>
        <button class="icon-btn small-btn" onclick={closeHint} title="Скрыть подсказку" aria-label="Скрыть подсказку"><Icon name="close" size={14} /></button>
      </p>
    {/if}
  </aside>
  {#if menu}
    {@const cur = menu}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="tg-menu" style:left="{cur.x}px" style:top="{cur.y}px" onclick={(e) => e.stopPropagation()}>
      <button onclick={() => togglePin(cur.key)}>
        <Icon name="pin" size={16} />{pinnedKeys.includes(cur.key) ? 'Открепить' : 'Закрепить'}
      </button>
      {#if chat.list.find((c) => c.key === cur.key)}
        {@const muted = !!chat.list.find((c) => c.key === cur.key)?.muted}
        <button onclick={() => ((menu = null), muteChat(cur.key, !muted))}>
          <Icon name="bell" size={16} />{muted ? 'Включить звук' : 'Без звука'}
        </button>
      {/if}
    </div>
  {/if}
  <main class="tg-main">
    {#if active}
      <!-- a new message to open at (a found mark, a link) opens the conversation anew, at it -->
      {#key `${active}|${focusId ?? ''}`}<ChatConversation key={active} focus={focusId} onback={backToList} />{/key}
    {:else}
      <div class="tg-placeholder"><span>Выберите чат</span></div>
    {/if}
  </main>
</div>
