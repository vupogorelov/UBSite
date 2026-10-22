<script>
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { chat, chatUi, onChatEvent, markRead, sendTyping, plainBody, toggleReaction } from '../lib/chat.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { navigate, onBack } from '../lib/router.svelte.js';
  import { MARKS } from '../lib/marks.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { REACTIONS } from '../../../shared/reactions.js';
  import Icon from './Icon.svelte';
  import ChatMessages from './ChatMessages.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import BookAiBar from './BookAiBar.svelte';
  import ChatPost from './ChatPost.svelte';
  import ChatAvatar from './ChatAvatar.svelte';
  import { visibility } from '../lib/visibility.js';
  import { findText } from '../lib/findtext.js';
  import { book } from '../lib/lang.svelte.js';
  import { pinchFont } from '../lib/pinch.js';
  import { settings, setSetting } from '../lib/settings.svelte.js';
  import { outbox, retry, discard } from '../lib/outbox.svelte.js';
  import { labApi } from '../features/lab/api.js';

  /** One conversation of the chat page; `focus`: a message to open it at. @type {{ key: string, focus?: number | null, onback?: () => void }} */
  let { key, focus = null, onback } = $props();

  let info = $state(/** @type {import('../lib/api.js').ChatInfo | null} */ (null));

  // ---- «Я и Книга», an administrator's: the Book answers by the search by meaning (the Laboratory),
  // each answer marked hit / missed — the Laboratory's marks, its score ----
  const judging = $derived(info?.kind === 'dm' && !!session.user?.isAdmin);
  let bookJudged = $state(/** @type {Record<number, boolean>} */ ({}));
  $effect(() => {
    if (!judging) return;
    labApi.bookJudged().then((r) => (bookJudged = r), () => {});
  });
  /** @param {{ id: number }} m @param {boolean | null} good */
  async function judgeBook(m, good) {
    const was = bookJudged;
    const next = { ...bookJudged };
    if (good === null) delete next[m.id];
    else next[m.id] = good;
    bookJudged = next;
    try {
      await labApi.judgeBook(m.id, good);
    } catch (e) {
      bookJudged = was;
      showToast(/** @type {Error} */ (e).message);
    }
  }
  /** @type {import('../lib/api.js').PublicMessage[]} */ let messages = $state([]);
  let hasMore = $state(true);
  let loadingOlder = false;
  let unreadAfter = $state(/** @type {number | null} */ (null));
  let reply = $state(/** @type {{ id: number, authorName: string | null, body: string } | null} */ (null));
  /** @type {HTMLElement | undefined} */ let scroller = $state();
  /** @type {ChatMessages | undefined} */ let list = $state();
  let atBottom = $state(true);
  let newBelow = $state(0);
  /** @type {ChatComposer | undefined} */ let composer = $state();

  /**
   * A quote from the book tapped in a paragraph's thread: the thread goes up to the paragraph (its post at
   * the top, older pages loaded first) and the quoted words light up there — the chat stays open; the
   * book is one tap away in the header. The light goes off with the next tap anywhere.
   * @param {string} text
   */
  async function showQuote(text) {
    const k = key;
    while (hasMore && messages.length) {
      const older = await api.chatMessages(k, messages[0].id).catch(() => null);
      if (!older || k !== key) return;
      messages = [...older, ...messages];
      hasMore = older.length >= 60;
    }
    await tick();
    const post = scroller?.querySelector('.tg-post');
    if (!post) return;
    const ru = post.querySelector('.tg-post-text');
    let range = ru && findText(ru, text);
    if (!range) {
      // a quote of the English text: open it under the paragraph
      /** @type {HTMLElement | null} */ (post.querySelector('.tg-post-en-toggle'))?.click();
      await tick();
      const en = post.querySelector('.tg-post-en');
      range = en && findText(en, text);
      // folded to one line: unfold, so the words are seen
      if (range && en?.classList.contains('collapsible') && !en.classList.contains('expanded')) {
        /** @type {HTMLElement} */ (en).click();
        await tick();
        range = findText(en, text);
      }
    }
    if (range && typeof Highlight !== 'undefined') {
      CSS.highlights.set('chat-quote', new Highlight(range));
      setTimeout(() => addEventListener('pointerdown', () => CSS.highlights.delete('chat-quote'), { once: true }), 300);
    }
    const target = range?.startContainer.parentElement ?? post;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!range) {
      post.classList.remove('flash');
      void (/** @type {HTMLElement} */ (post)).offsetWidth;
      post.classList.add('flash');
    }
  }
  $effect(() => () => void (typeof Highlight !== 'undefined' && CSS.highlights.delete('chat-quote')));

  /** A paragraph's thread: "Следить" / "Не следить" (notifications of its new messages). */
  // (these four — following, marks, the pinned one, reactions — show at once and go through the
  // device's queue: with or without a network; the server's answer settles them, a refusal undoes them)
  async function toggleFollow() {
    if (!info) return;
    const want = !info.following;
    info.following = want;
    api.follow(key, want).then(
      (r) => info && (info.following = r.following),
      (err) => {
        if (info) info.following = !want;
        if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
      },
    );
  }

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
      const wanted = focus ? document.getElementById(`msg-${focus}`) : null;
      // "Обсудить" from the book: the quote waits in the input, the conversation shows its latest
      const draft = chatUi.draft?.key === k ? chatUi.draft.text : null;
      chatUi.draft = null;
      // "Обсудить" under the Book's post: the answer to it is ready in the input
      const answer = chatUi.reply?.key === k ? list.find((m) => m.id === chatUi.reply?.id) : null;
      chatUi.reply = null;
      if (answer) reply = { id: answer.id, authorName: answer.authorName, body: plainBody(answer.body).slice(0, 200) };
      if (wanted) {
        // a message taller than the screen (the Book's post) — from its beginning
        const tall = scroller && wanted.offsetHeight > scroller.clientHeight * 0.8;
        wanted.scrollIntoView({ block: tall ? 'start' : 'center' });
        wanted.classList.add('flash');
      } else if (divider && !draft) divider.scrollIntoView({ block: 'center' });
      else scrollToBottom();
      if (draft) composer?.fill(draft);
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
      const p = info?.pinned;
      if (p && p.id === e.id) p.body = e.body.slice(0, 300);
    } else if (e.type === 'delete') {
      messages = messages.filter((m) => m.id !== e.id);
      if (info && info.pinned?.id === e.id) info.pinned = null;
    } else if (e.type === 'reactions') {
      const mine = (/** @type {any} */ r) => String(r.userIds ?? '').split(',').map(Number).includes(me ?? -1);
      messages = messages.map((m) => (m.id === e.id ? { ...m, reactions: e.reactions.map((/** @type {any} */ r) => ({ ...r, mine: mine(r) })) } : m));
    } else if (e.type === 'reload') {
      const fresh = await api.chatMessages(key).catch(() => null);
      if (fresh) messages = fresh;
      void refreshPinned(); // a hidden or shown message may be the pinned one
    } else if (e.type === 'pin') {
      void refreshPinned();
    } else if (e.type === 'mark') {
      messages = messages.map((m) => (m.id === e.id ? { ...m, mark: e.mark } : m));
    }
  }

  async function refreshPinned() {
    const k = key;
    const i = await api.chatInfo(k).catch(() => null);
    if (i && info && k === key) info.pinned = i.pinned;
  }

  /** "Обсудить" under the Book's post: its copy in the discussion, an answer to it ready. @param {any} m */
  function discuss(m) {
    if (!info?.discussion || !m.linkedId) return;
    chatUi.reply = { key: info.discussion, id: m.linkedId };
    navigate(`/chat?c=${encodeURIComponent(info.discussion)}&m=${m.linkedId}`);
  }

  // ---- The Book's voice: the administrator's controls in its channel ----
  let voice = $state(/** @type {{ paused: boolean, lastDay: string | null, hour: number } | null} */ (null));
  $effect(() => {
    if (info?.voice && session.user?.isAdmin) void api.voiceStatus().then((s) => (voice = s)).catch(() => {});
  });
  async function sayNow() {
    try {
      await api.voicePost();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
  async function togglePause() {
    if (!voice) return;
    try {
      voice = await api.voicePause(!voice.paused);
      showToast(voice.paused ? 'Голос Книги на паузе' : `Книга снова говорит каждый день в ${voice.hour}:00`);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }

  /** The administrator's mark take / work / done (null — off); the author is told by the server. @param {any} m @param {import('../lib/api.js').Mark | null} mark */
  async function markMessage(m, mark) {
    const was = m.mark ?? null;
    const set = (/** @type {any} */ v) => (messages = messages.map((x) => (x.id === m.id ? { ...x, mark: v } : x)));
    set(mark);
    api.markMessage(m.id, mark).then(
      (fresh) => set(fresh.mark ?? null),
      (err) => {
        set(was);
        if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
      },
    );
  }

  /** Pins a message instead of the pinned one; null unpins. @param {any} m */
  async function pin(m) {
    if (!info) return;
    const was = info.pinned;
    info.pinned = m ? { id: m.id, authorName: m.authorName, body: m.body, hiddenAt: m.hiddenAt ?? null } : null;
    api.pinMessage(key, m?.id ?? null).then(
      (r) => info && (info.pinned = r.pinned),
      (err) => {
        if (info) info.pinned = was;
        if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
      },
    );
  }

  /** To the pinned message. */
  const toPinned = () => info?.pinned && goTo(info.pinned.id);
  /** To a message: older pages are loaded until it is there. @param {number} id */
  async function goTo(id) {
    const k = key;
    while (!messages.some((m) => m.id === id) && hasMore && messages.length) {
      const older = await api.chatMessages(k, messages[0].id).catch(() => []);
      if (k !== key) return;
      messages = [...older, ...messages];
      hasMore = older.length >= 60;
    }
    list?.reveal(id);
  }

  /**
   * Sent through the device's queue (lib/outbox.svelte.js): the message is on screen at once with its
   * clock — with or without a network — and takes its place in the conversation when the server has it.
   * @param {string} body
   */
  async function send(body) {
    api
      .chatPost(key, body, reply?.id ?? null)
      .then((m) => {
        if (m && !messages.some((x) => x.id === m.id)) messages = [...messages, m];
      })
      .catch(() => {}); // (a refusal shows on the message itself: "!" and what to do)
    reply = null;
    await tick();
    scrollToBottom();
    return true;
  }

  // This conversation's messages still in the queue, drawn after the others (with their clock or "!").
  const postUrl = $derived(`/api/chat/c/${encodeURIComponent(key)}/messages`);
  const waiting = $derived(
    outbox.items
      .filter((o) => o.kind === 'message' && o.url === postUrl)
      .map((o) => {
        const b = /** @type {{ body: string, replyTo: number | null }} */ (o.body);
        const to = b.replyTo ? messages.find((x) => x.id === b.replyTo) : null;
        return {
          id: -(o.seq ?? 0),
          kind: /** @type {const} */ ('message'),
          authorId: me,
          authorName: session.user?.displayName ?? session.user?.username ?? null,
          body: b.body,
          createdAt: o.at.slice(0, 19).replace('T', ' '),
          reply: to ? { id: to.id, authorName: to.authorName, body: plainBody(to.body).slice(0, 200) } : null,
          reactions: [],
          pending: o.state,
          error: o.error,
          op: o,
        };
      })
      // (the server's live answer may come a moment before the queue lets go of it)
      .filter((p) => !messages.slice(-20).some((x) => x.authorId === me && x.body === p.body.trim() && x.createdAt >= p.createdAt.slice(0, 17))),
  );
  const shown = $derived(waiting.length ? [...messages, ...waiting] : messages);
  /** @param {any} m @param {string} emoji */
  async function react(m, emoji) {
    const was = m.reactions ?? [];
    const set = (/** @type {any[]} */ reactions) => (messages = messages.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    set(toggleReaction(was, emoji, session.user?.displayName ?? session.user?.username ?? ''));
    api.react(m.id, emoji).then(
      (r) => set(r.reactions),
      (err) => {
        set(was);
        if (err?.status !== 0) showToast(`Не сохранено: ${err.message}`);
      },
    );
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

  // ---- The search in the conversation: the magnifier in the header; in «Техподдержка» also the marks ----
  let searching = $state(false);
  let findText_ = $state('');
  let findMark = $state(/** @type {import('../lib/api.js').Mark | null} */ (null));
  /** @type {import('../lib/api.js').PublicMessage[]} */ let found = $state([]);
  let findDone = $state(false);
  /** @type {HTMLInputElement | undefined} */ let findInput = $state();
  const support = $derived(/** @type {import('../lib/api.js').ChatInfo | null} */ (info)?.title === 'Техподдержка');
  const findActive = $derived(searching && (findText_.trim().length > 1 || findMark !== null));
  function openSearch() {
    searching = true;
    void tick().then(() => findInput?.focus());
  }
  function closeSearch() {
    searching = false;
    findText_ = '';
    findMark = null;
    found = [];
  }
  $effect(() => {
    void key;
    closeSearch();
  });
  // Phone: "back" closes the search first.
  $effect(() => {
    if (searching) return onBack(() => void closeSearch());
  });
  $effect(() => {
    const k = key, text = findText_.trim(), mark = findMark;
    if (!findActive) return;
    findDone = false;
    const t = setTimeout(async () => {
      const list = await api.chatSearch(k, text.length > 1 ? text : '', mark).catch(() => []);
      if (k === key && text === findText_.trim() && mark === findMark) ((found = list), (findDone = true));
    }, 250);
    return () => clearTimeout(t);
  });
  /** A found message: the search closes, the conversation goes to it. @param {number} id */
  async function openFound(id) {
    closeSearch();
    await tick();
    await goTo(id);
  }
  /** The found words with a little of what stands before them. @param {string} body */
  function snippet(body) {
    const plain = plainBody(body);
    const w = findText_.trim().toLowerCase().split(/\s+/)[0];
    const i = w ? plain.toLowerCase().replace(/ё/g, 'е').indexOf(w.replace(/ё/g, 'е')) : -1;
    return i > 60 ? `…${plain.slice(i - 40)}` : plain;
  }
  const toDate = (/** @type {string} */ s) => new Date(s.replace(' ', 'T') + 'Z');
  /** "14:05" today, "06.10.26" otherwise. @param {string} s */
  function when(s) {
    const d = toDate(s);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  const typing = $derived(chat.typing[key]);
  /** Who can read this chat: under its title, before the paper's or channel's description. */
  const vis = $derived(info ? visibility(info) : null);
</script>

<section class="tg-chat" class:para-chat={info?.kind === 'para'}>
  {#if searching}
  <!-- the search: the field in place of the header; in «Техподдержка» the marks under it -->
  <header class="tg-chat-head tg-find-head">
    <button class="ui-round plain" onclick={closeSearch} aria-label="Закрыть поиск" title="Закрыть поиск"><Icon name="back" /></button>
    <label class="ui-search tg-find-field">
      <Icon name="search" size={18} />
      <input bind:this={findInput} bind:value={findText_} placeholder="Поиск в чате" aria-label="Поиск в чате" enterkeyhint="search" />
      {#if findText_ || findMark}<button class="ui-search-clear" onclick={(e) => (e.preventDefault(), (findText_ = ''), (findMark = null), findInput?.focus())} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
    </label>
  </header>
  {#if support}
    <div class="tg-mark-filter tg-find-marks" role="group" aria-label="Сообщения с отметкой">
      {#each MARKS as [mk, label] (mk)}
        <button class="tg-mark" data-mark={mk} class:on={findMark === mk} aria-pressed={findMark === mk} title={label}
          onclick={() => (findMark = findMark === mk ? null : mk)}>{mk}</button>
      {/each}
    </div>
  {/if}
  {:else}
  <header class="tg-chat-head">
    {#if onback}<button class="ui-round plain tg-back" onclick={onback} aria-label="К списку чатов"><Icon name="back" /></button>{/if}
    <ChatAvatar chat={info} />
    <div class="tg-chat-title">
      <b>{#if info?.voice}<span class="tg-chan-mark" title="Канал" role="img" aria-label="Канал:"><Icon name="megaphone" size={15} /></span>{/if}{info?.title ?? '…'}</b>
      {#if typing}<span class="tg-typing">{typing.name} печатает<span class="tg-dots"><i></i><i></i><i></i></span></span>
      {:else if vis}<span class="muted tg-vis-line"><span class="tg-vis" title={vis.full}><Icon name={vis.icon} size={13} />{vis.short}</span>{#if info?.kind !== 'ws' && info?.subtitle}<span class="ellipsis">· {info.subtitle}</span>{/if}</span>{/if}
    </div>
    <span class="spacer"></span>
    <button class="icon-btn tg-find" onclick={openSearch} aria-label="Поиск в чате" title="Поиск в чате"><Icon name="search" /></button>
    {#if info?.kind === 'para'}
      <!-- A paragraph's thread: follow it (notifications) and go to its place in the book -->
      <button class="icon-btn tg-follow" class:on={info.following} onclick={toggleFollow}
        aria-label={info.following ? 'Вы следите — отписаться' : 'Следить'}
        title={info.following ? 'Вы получаете уведомления о новых сообщениях в этом абзаце. Нажмите, чтобы отписаться' : 'Получать уведомления о новых сообщениях в этом абзаце'}>
        <Icon name={info.following ? 'eye' : 'eye-off'} />
      </button>
      <button class="btn" onclick={() => navigate(`/${key}`)}><Icon name="book-open" size={16} />Открыть в книге</button>
    {:else if info?.link}
      <!-- a feature's chat (an article's discussion): the way to what it is about -->
      {@const link = info.link}
      <button class="btn" onclick={() => navigate(link)}><Icon name="dictionary" size={16} />{info.linkLabel ?? 'Открыть'}</button>
    {/if}
  </header>
  {/if}
  {#if findActive}
    <!-- what was found: newest first; a tap goes to the message -->
    <div class="tg-found">
      {#if findDone && found.length}<div class="ui-label tg-found-count">{found.length === 100 ? 'Первые 100' : found.length} · новые сверху</div>{/if}
      <ol class="tg-marked">
        {#each found as m (m.id)}
          <li>
            <button class="tg-marked-item" onclick={() => openFound(m.id)}>
              <span class="tg-chat-line">
                <b class="ellipsis">{m.authorName ?? 'Участник'}{#if m.mark}<span class="tg-mark" data-mark={m.mark}>{m.mark}</span>{/if}</b>
                <span class="tg-chat-time">{when(m.createdAt)}</span>
              </span>
              <span class="tg-marked-body">{snippet(m.body)}</span>
            </button>
          </li>
        {:else}
          <li class="muted small tg-marked-empty">{findDone ? 'Ничего не найдено.' : 'Поиск…'}</li>
        {/each}
      </ol>
    </div>
  {/if}
  {#if info?.pinned && !findActive}
    {@const p = info.pinned}
    <!-- The pinned message: a tap goes to it; × unpins (whoever made the chat, administrators) -->
    <div class="tg-pinned">
      <button class="tg-pinned-go" onclick={toPinned} title="К закреплённому сообщению">
        <Icon name="pin" size={16} />
        <span class="tg-pinned-text"><b>Закреплённое{p.authorName ? ` · ${p.authorName}` : ""}</b><span class="ellipsis">{p.body || 'Сообщение скрыто'}</span></span>
      </button>
      {#if info.canPin}<button class="icon-btn small-btn" onclick={() => pin(null)} aria-label="Открепить" title="Открепить"><Icon name="close" size={16} /></button>{/if}
    </div>
  {/if}
  <!-- a paragraph's thread: two fingers change its own font size (not the book's) -->
  <div class="tg-scroll" class:hidden={findActive} bind:this={scroller} onscroll={onScroll}
    use:pinchFont={{ get: () => settings.chatFontSize, set: (px) => setSetting('chatFontSize', px), min: 12, max: 24, anchor: '.tg-row, .tg-post' }}>
    <!-- The conversation is as wide as the book's column (the reader's "Ширина колонки"). -->
    <div class="tg-column">
      {#if info?.kind === 'para' && info.post && !hasMore}
        <!-- A paragraph thread starts with the paragraph itself, as a channel post; messages are its comments. -->
        <ChatPost ref={key} paperId={info.post.paperId} paperTitle={book.main === 'en' ? info.post.paperTitleEn || info.post.paperTitle : info.post.paperTitle} pageRef={info.post.pageRef}
          ru={info.post.ru} en={info.post.en} comments={messages.filter((m) => m.kind === 'message').length} />
        {#if messages.length}<div class="tg-service"><span>Обсуждение</span></div>{/if}
      {:else if !hasMore && messages.length}
        <div class="tg-service"><span>Начало переписки</span></div>
      {/if}
      {#if info && !messages.length && info.kind === 'dm'}
        <!-- "Я и Книга": what it is, before the first question -->
        <div class="tg-empty dm-intro"><span>
          <b>Спросите Книгу</b> о том, что вас волнует — о Боге, душе, смысле жизни, о любом понятии.
          Книга ответит своими словами — коротко, со ссылками — и покажет абзацы, которые говорят об этом больше всего.
          Каждый можно открыть в книге.
          Этот разговор видите только вы.
        </span></div>
      {:else if info && !messages.length}<div class="tg-empty" class:after-post={info.kind === 'para'}><span>Сообщений пока нет — напишите первое.</span></div>{/if}
      <ChatMessages bind:this={list} messages={shown} {me} {unreadAfter} reactions={REACTIONS} chatKey={key}
        onretry={(m) => m.op && retry(m.op)} ondiscard={(m) => m.op && discard(m.op)}
        onreply={(m) => (reply = { id: m.id, authorName: m.authorName, body: plainBody(m.body).slice(0, 200) })}
        onreact={react} onedit={edit} ondelete={remove} onhide={hide} canhide={coordinator && info?.kind !== 'ws'}
        onpin={info?.canPin ? pin : undefined} pinnedId={info?.pinned?.id ?? null}
        onquote={info?.kind === 'para' ? showQuote : undefined}
        onmark={session.user?.isAdmin ? markMessage : undefined}
        ondiscuss={info?.discussion ? discuss : undefined}
        onjudge={judging ? judgeBook : undefined} judged={bookJudged} />
    </div>
  </div>
  {#if findActive}
    <!-- (the found list stands in place of the conversation) -->
  {:else if newBelow}
    <button class="tg-down" onclick={scrollToBottom} aria-label="К новым сообщениям"><Icon name="down" /><span>{newBelow}</span></button>
  {/if}
  {#if findActive}
    <!-- (no composer over the found list) -->
  {:else if info?.voice}
    <!-- The Book's voice: only the Book speaks here; people talk in the discussion. The administrator: say now, pause -->
    <p class="tg-chan-note">Канал · пишет только Книга, обсуждают в «Общем»</p>
    <div class="tg-voice-bar">
      {#if info.discussion}
        <button class="btn tg-voice-discuss" onclick={() => info?.discussion && navigate(`/chat?c=${encodeURIComponent(info.discussion)}`)}
          title="Посты Книги обсуждают в «Общем»"><Icon name="discuss" size={16} />Обсуждение</button>
      {/if}
      {#if session.user?.isAdmin && voice}
        <button class="btn" onclick={sayNow} title="Опубликовать абзац сейчас"><Icon name="play" size={16} />Сейчас</button>
        <button class="icon-btn" class:on={voice.paused} onclick={togglePause} aria-pressed={voice.paused}
          title={voice.paused ? 'Голос на паузе — нажмите, чтобы Книга снова говорила каждый день' : `Каждый день в ${voice.hour}:00 по Москве; нажмите, чтобы поставить на паузу`}>
          <Icon name={voice.paused ? 'play' : 'pause'} /></button>
      {/if}
    </div>
  {:else if info?.archived}
    <div class="tg-archived muted">Канал в архиве — только чтение</div>
  {:else}
    {#if info?.kind === 'dm'}<BookAiBar answers={messages.filter((m) => m.authorAgent && !m.post).length} />{/if}
    <ChatComposer bind:this={composer} onsend={send} {reply} oncancelreply={() => (reply = null)} ontyping={() => sendTyping(key)}
      placeholder={info?.kind === 'dm' ? 'Спросите Книгу…' : 'Сообщение'} />
  {/if}
</section>
