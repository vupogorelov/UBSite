<script>
  import { tick } from 'svelte';
  import { userColor, initials, plainBody } from '../lib/chat.svelte.js';
  import { MARKS, markTitle } from '../lib/marks.js';
  import { navigate } from '../lib/router.svelte.js';
  import { copyText, createNote } from '../lib/notes.svelte.js';
  import { collections, loadCollections, addToCollection } from '../lib/collections.svelte.js';
  import { session, can } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { createTask } from '../lib/tasks.svelte.js';
  import { swipeReply } from '../lib/swipe.js';
  import Icon from './Icon.svelte';
  import BookPost from './BookPost.svelte';
  import Fold from './Fold.svelte';
  import { settings } from '../lib/settings.svelte.js';

  /**
   * @typedef {{
   *   id: number, authorId: number | null, authorName: string | null, body: string, createdAt: string, updatedAt?: string,
   *   kind?: 'message' | 'event', hiddenAt?: string | null, mark?: import('../lib/api.js').Mark | null,
   *   authorAgent?: boolean, linkedId?: number | null, comments?: number, post?: import('../lib/api.js').PublicMessage['post'],
   *   reply?: { id: number, authorName: string | null, body: string } | null,
   *   reactions?: import('../lib/api.js').Reaction[], writtenAt?: string | null,
   *   pending?: 'wait' | 'failed', error?: string, op?: any
   * }} Msg
   */

  /**
   * A conversation drawn like Telegram: bubbles (own on the right; all corners alike, no tails), grouped runs of one
   * author with the avatar at the end, date pills, service messages, replies (also a swipe to the left), reactions;
   * one's sent message — a check, read by another — two (`readUpTo`). `solo`: one on one — no avatars, no names (who writes is plain).
   * Used by the chat page, paragraph threads, proposal discussions and note comments.
   * `render`: the body as HTML instead of plain text with links (notes' comments: **bold**, #tags…);
   * `candeleteall`: delete others' messages too (the owner of a note's workspace);
   * `chatKey`: the conversation — its messages can be kept: «В подборку» (any), «В заметки» (one with a
   * place in the book: a paragraph thread's, or one that refers to a paragraph);
   * `onpin`: pin a message, null unpins (given to whoever made the chat and to administrators);
   * `onquote`: a quote from the book tapped in a paragraph's thread (shown in the paragraph there);
   * `onmark`: the administrator's marks take / work / done (lib/marks.js);
   * `ondiscuss`: a Book's post of the channel → its discussion in the general chat.
   * `writtenAt`: written without a network, sent later — its time is shown. `pending`: still in the
   * device's queue (lib/outbox.svelte.js): a clock, or "!" with `error` and «Повторить» / «Удалить».
   * @type {{
   *   messages: Msg[], me: number | null, compact?: boolean, unreadAfter?: number | null,
   *   reactions?: string[],
   *   onreply?: (m: Msg) => void, onreact?: (m: Msg, emoji: string) => void,
   *   onedit?: (m: Msg, body: string) => Promise<unknown>, ondelete?: (m: Msg) => void,
   *   onhide?: (m: Msg) => void, canhide?: boolean, candeleteall?: boolean, render?: (body: string) => string,
   *   chatKey?: string | null, onpin?: (m: Msg | null) => void, pinnedId?: number | null,
   *   onquote?: (text: string) => void, onmark?: (m: Msg, mark: import('../lib/api.js').Mark | null) => void,
   *   ondiscuss?: (m: Msg) => void, onretry?: (m: Msg) => void, ondiscard?: (m: Msg) => void,
   *   onjudge?: (m: Msg, good: boolean | null) => void, judged?: Record<number, boolean>,
   *   solo?: boolean, readUpTo?: number
   * }}
   * `onjudge`, `judged`: the Book's answers in an administrator's «Я и Книга» marked hit / missed (the Laboratory).
   */
  let { messages, me, compact = false, unreadAfter = null, reactions = [], onreply, onreact, onedit, ondelete, onhide, canhide = false, candeleteall = false, render, chatKey = null, onpin, pinnedId = null, onquote, onmark, ondiscuss, onretry, ondiscard, onjudge, judged = {}, solo = false, readUpTo = 0 } = $props();

  const toDate = (/** @type {string} */ s) => new Date(s.replace(' ', 'T') + 'Z');
  const dayKey = (/** @type {string} */ s) => toDate(s).toDateString();
  const time = (/** @type {string} */ s) => toDate(s).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  /** "Сегодня" / "Вчера" / "6 октября" / "6 октября 2025". @param {string} s */
  function dayLabel(s) {
    const d = toDate(s);
    const now = new Date();
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  /** One run: same author, same day, less than 10 minutes apart. @param {Msg | undefined} a @param {Msg | undefined} b */
  const together = (a, b) =>
    !!a && !!b && a.kind !== 'event' && b.kind !== 'event' && a.authorId === b.authorId && dayKey(a.createdAt) === dayKey(b.createdAt) &&
    Math.abs(toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()) < 10 * 60_000;

  const rows = $derived(
    messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      return {
        m,
        own: m.authorId !== null && m.authorId === me,
        day: !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt),
        first: !together(prev, m),
        last: !together(m, next),
        unread: unreadAfter !== null && m.id > unreadAfter && (!prev || prev.id <= unreadAfter) && m.authorId !== me,
        // the Book's answer right under the question: no need to quote it again
        quoteShown: !!m.reply && !(m.authorAgent && prev?.id === m.reply.id),
      };
    }),
  );
  /**
   * The rows by day. Each day is its own block, so its date pill sticks to the top only while that
   * day is on screen and leaves with it (one container for all days would pile the pills up).
   */
  const days = $derived(
    rows.reduce((out, r) => {
      if (r.day || !out.length) out.push({ key: dayKey(r.m.createdAt), at: r.m.createdAt, rows: [] });
      out[out.length - 1].rows.push(r);
      return out;
    }, /** @type {{ key: string, at: string, rows: typeof rows }[]} */ ([])),
  );

  /**
   * Text with **bold** and *italic* (as in Telegram; an AI's answers write so — what is inside goes on with its
   * links), @mentions, paragraph references (5:1.2 → the book) and links. @param {string} text
   */
  function tokens(text) {
    /** @type {{ t: 'text' | 'b' | 'i' | 'mention' | 'ref' | 'url', v: string }[]} */
    const out = [];
    const re = /\*\*(?=\S)([^*]+?)(?<=\S)\*\*|(?<![*\p{L}\p{N}])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\p{L}\p{N}])|(@[\p{L}\p{N}_.-]{2,40})|(\b\d{1,3}:\d{1,2}\.\d{1,3}\b)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/gu;
    let at = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > at) out.push({ t: 'text', v: text.slice(at, m.index) });
      if (m[1] !== undefined || m[2] !== undefined) out.push({ t: m[1] !== undefined ? 'b' : 'i', v: m[1] ?? m[2] });
      else out.push({ t: m[3] ? 'mention' : m[4] ? 'ref' : 'url', v: m[0] });
      at = m.index + m[0].length;
    }
    if (at < text.length) out.push({ t: 'text', v: text.slice(at) });
    return out;
  }

  /**
   * The body's quotes ("> " lines, as in Markdown) and the text around them; the blank lines next to a
   * quote are left out (the block itself separates).
   * @param {string} body
   */
  function blocks(body) {
    /** @type {{ quote: boolean, text: string }[]} */
    const out = [];
    for (const line of body.split('\n')) {
      const quote = /^> ?/.test(line);
      const text = quote ? line.replace(/^> ?/, '') : line;
      const last = out.at(-1);
      if (last && last.quote === quote) last.text += `\n${text}`;
      else out.push({ quote, text });
    }
    return out.map((b) => ({ ...b, text: b.text.replace(/^\n+|\n+$/g, '') })).filter((b) => b.quote || b.text);
  }
  /** In a paragraph's thread a quote is from the book: its source goes above it. */
  const bookRef = $derived(chatKey && /^\d+:\d+\.\d+$/.test(chatKey) ? chatKey : null);

  // ---- Context menu (right click; a tap on touch screens) and inline editing ----
  let menu = $state(/** @type {{ m: Msg, own: boolean, x: number, y: number } | null} */ (null));
  /** @param {MouseEvent} e @param {Msg} m @param {boolean} own */
  function openMenu(e, m, own) {
    if (m.kind === 'event' || m.pending) return; // (not on the server yet: nothing to reply to or react on)
    e.preventDefault();
    collecting = false;
    tasking = false;
    menu = { m, own, x: Math.min(e.clientX, innerWidth - 320), y: Math.min(e.clientY, innerHeight - 340) };
  }
  /**
   * A touch screen: one tap on a message opens its menu (links, quotes, reactions and editing keep their
   * own taps); with a menu open, a tap only closes it.
   */
  let pointer = '';
  /** @param {MouseEvent} e @param {Msg} m @param {boolean} own */
  function tap(e, m, own) {
    if (pointer !== 'touch' || menu || editingId === m.id || m.pending) return;
    if (/** @type {HTMLElement} */ (e.target).closest('a, button, textarea, .tg-bq-go') || getSelection()?.isCollapsed === false) return;
    e.stopPropagation(); // the window's click would close it at once
    openMenu(e, m, own);
  }
  /** A link to the message: the chat page opens the conversation at it. @param {Msg} m */
  const linkTo = (m) => `${location.origin}/chat?c=${encodeURIComponent(chatKey ?? '')}&m=${m.id}`;

  let editingId = $state(/** @type {number | null} */ (null));
  let draft = $state('');
  async function saveEdit() {
    const m = messages.find((x) => x.id === editingId);
    if (!m || !onedit || !draft.trim()) return;
    if (await onedit(m, draft.trim())) editingId = null;
  }

  // ---- Keeping a message: «В подборку», «В заметки» (VISION.md, principle 4) ----
  /** The message's place in the book: the thread's paragraph, or the first paragraph it refers to. @param {Msg} m */
  function placeOf(m) {
    if (!chatKey || chatKey.startsWith('note:')) return null; // a note's comment is in the notes already
    if (m.post) return m.post.ref; // the Book's word: its paragraph
    if (/^\d+:\d+\.\d+$/.test(chatKey)) return chatKey;
    return m.body.match(/\b\d{1,3}:\d{1,2}\.\d{1,3}\b/)?.[0] ?? null;
  }
  /** A note on the message's paragraph in the current workspace, quoting it. @param {Msg} m */
  async function toNotes(m) {
    const ref = placeOf(m);
    if (!ref) return;
    const when = toDate(m.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
    // "@" is kept from turning the quote's mentions into new ones (U+2060 between "@" and the name)
    const comment = `«${m.body.replaceAll('@', '@⁠')}»\n— ${m.authorName ?? 'Участник'}, ${when}`;
    if (await createNote({ ref, lang: null, start: null, end: null, quote: null }, { comment })) {
      showToast(`Сохранено в заметки · ${ref} · ${session.workspace?.kind === 'group' ? session.workspace.name : 'Личное'}`);
    }
  }
  /** A touch screen: the menu is a sheet at the bottom and its fields do not take the focus by themselves. */
  const touch = matchMedia('(pointer: coarse)').matches;
  // «В задачи»: a personal task with the way back to the message (and its place in the book)
  let tasking = $state(false);
  let taskTitle = $state('');
  /** @param {Msg} m */
  function startTask(m) {
    const text = m.body.replace(/\s+/g, ' ').trim();
    taskTitle = text.length > 80 ? `${text.slice(0, 80).trimEnd()}…` : text;
    tasking = true;
  }
  /** @param {Msg} m */
  async function addTask(m) {
    if (!taskTitle.trim()) return;
    const when = toDate(m.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
    const t = await createTask({
      title: taskTitle.trim(), messageId: m.id,
      notes: `«${m.body}»\n— ${m.authorName ?? 'Участник'}, ${when}`,
    });
    if (t) {
      showToast('Задача добавлена — она в «Моих задачах»');
      menu = null;
      tasking = false;
    }
  }
  let collecting = $state(false);
  let newTitle = $state('');
  /** @param {Msg} m @param {number | null} id */
  async function collect(m, id) {
    if (await addToCollection(id, { kind: 'message', messageId: m.id }, newTitle.trim())) {
      menu = null;
      collecting = false;
      newTitle = '';
    }
  }
  function startCollect() {
    collecting = true;
    void loadCollections();
  }
  const ownCollections = $derived(
    [...collections.own].sort((a, b) => (b.id === collections.lastId ? 1 : 0) - (a.id === collections.lastId ? 1 : 0)),
  );

  /** Scrolls to a quoted message and flashes it. @param {number} id */
  export async function reveal(id) {
    await tick();
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === 'Escape' && (menu = null)} onscroll={() => (menu = null)} />

{#snippet rich(/** @type {string} */ text)}
  {#each tokens(text) as tok, i (i)}
    {#if tok.t === 'b'}<b>{@render rich(tok.v)}</b>
    {:else if tok.t === 'i'}<i>{@render rich(tok.v)}</i>
    {:else if tok.t === 'mention'}<span class="tg-mention">{tok.v}</span>
    {:else if tok.t === 'ref'}<a class="tg-link" href="/{tok.v}" onclick={(e) => (e.preventDefault(), navigate(`/${tok.v}`))}>{tok.v}</a>
    {:else if tok.t === 'url'}<a class="tg-link" href={tok.v} target="_blank" rel="noopener noreferrer">{tok.v}</a>
    {:else}{tok.v}{/if}
  {/each}
{/snippet}

<div class="tg" class:compact>
  {#each days as d (d.key)}
  <div class="tg-day">
  <div class="tg-service tg-date"><span>{dayLabel(d.at)}</span></div>
  {#each d.rows as { m, own, first, last, unread, quoteShown } (m.id)}
    {#if unread}<div class="tg-unread"><span>Непрочитанные сообщения</span></div>{/if}
    {#if m.kind === 'event'}
      <div class="tg-service" id="msg-{m.id}"><span>{m.body}</span></div>
    {:else}
      <!-- (post: the Book's post — a taller row; app.css: its height guessed before it is laid out) -->
      <div class="tg-row" class:own class:first class:last class:post={!!m.post} id="msg-{m.id}"
        use:swipeReply={onreply && editingId !== m.id && !m.pending ? () => onreply?.(m) : undefined}>
        {#if onreply}<span class="tg-swipe-icon" aria-hidden="true"><Icon name="back" size={16} /></span>{/if}
        {#if !own && !compact && !solo}
          <span class="tg-avatar-slot">
            {#if last && m.authorAgent}<span class="tg-avatar book" title={m.authorName ?? 'Книга'}><Icon name="book-open" size={17} /></span>
            {:else if last}<span class="tg-avatar" style:--c={userColor(m.authorId)} title={m.authorName ?? ''}>{initials(m.authorName)}</span>{/if}
          </span>
        {/if}
        <!-- (a tap opens the message's menu on a touch screen; the keyboard has the context-menu key) -->
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div class="tg-bubble" class:hidden-msg={!!m.hiddenAt} class:book={!!m.post}
          oncontextmenu={(e) => openMenu(e, m, own)} ondblclick={() => !m.pending && onreply?.(m)}
          onpointerdown={(e) => (pointer = e.pointerType)} onclick={(e) => tap(e, m, own)}>
          {#if !own && first && !solo}<div class="tg-name" class:book={m.authorAgent} style:color={m.authorAgent ? null : userColor(m.authorId)}>{m.authorName ?? 'Участник'}</div>{/if}
          {#if m.reply && quoteShown}
            <button class="tg-quote" style:--c={userColor(null)} onclick={() => m.reply && reveal(m.reply.id)}>
              <b>{m.reply.authorName ?? 'Участник'}</b><span>{plainBody(m.reply.body) || 'Сообщение скрыто'}</span>
            </button>
          {/if}
          {#if editingId === m.id}
            <!-- svelte-ignore a11y_autofocus -->
            <textarea class="tg-edit" bind:value={draft} autofocus rows="3"
              onkeydown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? (e.preventDefault(), saveEdit()) : e.key === 'Escape' && (editingId = null))}></textarea>
            <!-- editing: Enter is a new line; saving — the button or Ctrl+Enter -->
            <div class="tg-edit-actions">
              <button class="link-btn small" onclick={() => (editingId = null)}>Отмена</button>
              <button class="link-btn small" onclick={saveEdit} title="Сохранить (Ctrl+Enter)">Сохранить</button>
            </div>
          {:else if m.hiddenAt && !m.body}
            <div class="tg-text muted"><i>Сообщение скрыто координатором</i></div>
          {:else if m.post}
            <!-- the Book's word: its paragraph (in the channel — with the way to its discussion) -->
            <BookPost post={m.post} comments={m.comments ?? 0} ondiscuss={m.linkedId && ondiscuss ? () => ondiscuss?.(m) : undefined} />
            {#if onjudge && m.authorAgent}
              <!-- «Я и Книга», an administrator's: does this paragraph answer the question? (the Laboratory's marks) -->
              {@const j = judged[m.id]}
              <div class="tg-judge" role="group" aria-label="Ответ попал?">
                <button class="tg-judge-btn good" class:on={j === true} aria-pressed={j === true} onclick={() => onjudge(m, j === true ? null : true)}
                  title="Попал: этот абзац отвечает на вопрос"><Icon name="check" size={14} />Попал</button>
                <button class="tg-judge-btn bad" class:on={j === false} aria-pressed={j === false} onclick={() => onjudge(m, j === false ? null : false)}
                  title="Мимо: не об этом"><Icon name="close" size={14} />Мимо</button>
              </div>
            {/if}
          {:else if render}
            <div class="tg-text comment-body">{@html render(m.body)}<span class="tg-meta-space"></span></div>
          {:else}
            <div class="tg-text"><Fold on={settings.chatFold}>
              {#each blocks(m.body) as b, bi (bi)}
                {#if b.quote}
                  <!-- "> …" lines: a quote, as Telegram draws it; in a paragraph's thread — from the book -->
                  {#if bookRef && onquote}
                    <!-- a tap shows the quoted words in the paragraph at the top of this thread -->
                    <div class="tg-bq tg-bq-go" role="button" tabindex="0" title="Показать в абзаце"
                      onclick={(e) => (e.stopPropagation(), onquote?.(b.text))}
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onquote?.(b.text))}>
                      <b class="tg-bq-src">Книга Урантии · {bookRef}</b>
                      <span>{b.text}</span>
                    </div>
                  {:else}
                    <blockquote class="tg-bq">
                      {#if bookRef}<a class="tg-bq-src" href="/{bookRef}" onclick={(e) => (e.preventDefault(), navigate(`/${bookRef}`))}>Книга Урантии · {bookRef}</a>{/if}
                      <span>{@render rich(b.text)}</span>
                    </blockquote>
                  {/if}
                {:else}{@render rich(b.text)}{/if}
              {/each}</Fold><span class="tg-meta-space"></span>
            </div>
          {/if}
          {#if m.reactions?.length}
            <div class="tg-reactions">
              {#each m.reactions as r (r.emoji)}
                <button class="tg-reaction" class:mine={r.mine} title={r.who} onclick={() => onreact?.(m, r.emoji)} disabled={!onreact}>
                  <span>{r.emoji}</span>{r.n}
                </button>
              {/each}
            </div>
          {/if}
          {#if m.pending === 'failed'}
            <!-- refused by the server: why, and what to do -->
            <div class="tg-failed-row">
              <span>Не отправлено{m.error ? `: ${m.error}` : ''}</span>
              <button class="link-btn small" onclick={(e) => (e.stopPropagation(), onretry?.(m))}>Повторить</button>
              <button class="link-btn small" onclick={(e) => (e.stopPropagation(), ondiscard?.(m))}>Удалить</button>
            </div>
          {/if}
          <span class="tg-meta">
            {#if m.hiddenAt && m.body}<span title="Скрыто координатором">скрыто ·</span>{/if}
            {#if m.mark}<span class="tg-mark" data-mark={m.mark} title={markTitle(m.mark)}>{m.mark}</span>{/if}
            {#if m.updatedAt && m.updatedAt !== m.createdAt}<span>изм.</span>{/if}
            {time(m.writtenAt ?? m.createdAt)}
            {#if m.pending === 'wait'}<span class="tg-wait" title="Отправится, когда будет связь"><Icon name="clock" size={13} /></span>
            {:else if m.pending === 'failed'}<span class="tg-failed" title={m.error}><Icon name="alert" size={13} /></span>
            {:else if own && m.id <= readUpTo}<span class="tg-check read" title="Прочитано"><Icon name="check-double" size={15} /></span>
            {:else if own}<span class="tg-check" title="Отправлено"><Icon name="check" size={13} /></span>{/if}
          </span>
        </div>
        {#if onreply && editingId !== m.id && !m.pending}
          <button class="tg-hover-reply" onclick={() => onreply?.(m)} aria-label="Ответить" title="Ответить (или двойной щелчок)"><Icon name="back" size={14} /></button>
        {/if}
      </div>
    {/if}
  {/each}
  </div>
  {/each}
</div>

{#if menu}
  {@const cur = menu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="tg-menu" style:left="{cur.x}px" style:top="{cur.y}px" onclick={(e) => e.stopPropagation()}>
    {#if tasking}
      <!-- «В задачи»: what to do (from the message's beginning) -->
      <button onclick={() => (tasking = false)}><Icon name="back" size={16} />В задачи</button>
      <form class="tg-menu-task" onsubmit={(e) => (e.preventDefault(), addTask(cur.m))}>
        <!-- on a phone the keyboard does not pop up by itself: the title is often fine as it is -->
        <!-- svelte-ignore a11y_autofocus -->
        <input class="text-input" bind:value={taskTitle} autofocus={!touch} autocomplete="off" enterkeyhint="done"
          aria-label="Задача" placeholder="Что сделать" />
        <button class="btn primary" disabled={!taskTitle.trim()}>Добавить</button>
      </form>
    {:else if collecting}
      <!-- «В подборку»: the workspace's collections (the last used first) or a new one -->
      <button onclick={() => (collecting = false)}><Icon name="back" size={16} />В подборку</button>
      <div class="tg-menu-list">
        {#each ownCollections as c (c.id)}
          <button onclick={() => collect(cur.m, c.id)}><Icon name="layers" size={16} /><span class="ellipsis">{c.title}</span></button>
        {/each}
      </div>
      <form class="add-coll-new" onsubmit={(e) => (e.preventDefault(), collect(cur.m, null))}>
        <input class="text-input" bind:value={newTitle} autocomplete="off" placeholder="Новая подборка…" aria-label="Название новой подборки" />
        <button class="icon-btn small-btn" disabled={!newTitle.trim()} aria-label="Создать и добавить" title="Создать и добавить"><Icon name="plus" /></button>
      </form>
    {:else}
    {#if onreact && reactions.length}
      <div class="tg-menu-reactions">
        {#each reactions as r (r)}<button onclick={() => (onreact?.(cur.m, r), (menu = null))} aria-label="Реакция {r}">{r}</button>{/each}
      </div>
    {/if}
    {#if onreply}<button onclick={() => (onreply?.(cur.m), (menu = null))}><Icon name="back" size={16} />Ответить</button>{/if}
    <button onclick={() => (copyText(cur.m.body), (menu = null))}><Icon name="copy" size={16} />Копировать текст</button>
    {#if chatKey}
      <button onclick={() => (copyText(linkTo(cur.m)), (menu = null))}><Icon name="link" size={16} />Копировать ссылку</button>
    {/if}
    {#if onmark}
      <!-- the administrator: what became of it (a bug, an idea) — taken, in work, done; again — off -->
      <div class="tg-menu-marks" role="group" aria-label="Отметка">
        {#each MARKS as [mk, label] (mk)}
          <button class="tg-mark" data-mark={mk} class:on={cur.m.mark === mk} aria-pressed={cur.m.mark === mk} title={label}
            onclick={() => (onmark?.(cur.m, cur.m.mark === mk ? null : mk), (menu = null))}>{mk}</button>
        {/each}
      </div>
    {/if}
    {#if onpin}
      <button onclick={() => (onpin?.(pinnedId === cur.m.id ? null : cur.m), (menu = null))}>
        <Icon name="pin" size={16} />{pinnedId === cur.m.id ? 'Открепить' : 'Закрепить'}
      </button>
    {/if}
    {#if chatKey && can.comment && placeOf(cur.m)}
      <button onclick={() => (toNotes(cur.m), (menu = null))} title="Заметка на абзац {placeOf(cur.m)} с этой цитатой">
        <Icon name="notes" size={16} />В заметки · {placeOf(cur.m)}
      </button>
    {/if}
    {#if chatKey && can.edit}
      <button onclick={startCollect}><Icon name="layers" size={16} />В подборку…</button>
    {/if}
    {#if chatKey}
      <button onclick={() => startTask(cur.m)}><Icon name="check-square" size={16} />В задачи…</button>
    {/if}
    {#if cur.own && onedit}
      <button onclick={() => ((editingId = cur.m.id), (draft = cur.m.body), (menu = null))}><Icon name="edit" size={16} />Изменить</button>
    {/if}
    {#if canhide && onhide}
      <button onclick={() => (onhide?.(cur.m), (menu = null))}><Icon name="eye-off" size={16} />{cur.m.hiddenAt ? 'Показать' : 'Скрыть (координатор)'}</button>
    {/if}
    {#if (cur.own || candeleteall) && ondelete}
      <button class="danger-text" onclick={() => (ondelete?.(cur.m), (menu = null))}><Icon name="trash" size={16} />Удалить</button>
    {/if}
    {/if}
  </div>
{/if}
