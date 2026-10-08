<script>
  import { tick } from 'svelte';
  import {
    notes, colorName, formatTime, submitDraft, addComment, editComment, deleteComment, patchNote, deleteNote, setNoteTags,
  } from '../lib/notes.svelte.js';
  import { renderBody } from '../lib/markup.js';
  import { navigate } from '../lib/router.svelte.js';
  import { tagColor } from '../lib/tags.svelte.js';
  import { showNotesForTag } from '../lib/ui.svelte.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';
  import { blurOnRemove } from '../lib/focus.js';
  import { can, session } from '../lib/session.svelte.js';
  import { userColor } from '../lib/chat.svelte.js';

  /** Author names matter only where several people write. */
  const showAuthors = $derived(session.workspace?.kind === 'group');

  /**
   * A comment thread card. `note` is an existing annotation; without it the card edits notes.draft.
   * @type {{ note?: import('../lib/api.js').Note, showQuote?: boolean, onclose?: () => void }}
   */
  let { note, showQuote = false, onclose } = $props();

  const isDraft = $derived(!note);
  const active = $derived(isDraft || notes.activeId === note?.id);
  const quote = $derived(note ? note.quote : notes.draft?.quote ?? null);
  const ref = $derived(note?.ref ?? notes.draft?.ref ?? '');

  let reply = $state('');
  /** @type {number | null} */
  let editingId = $state(null);
  let editText = $state('');
  let confirmDelete = $state(false);
  let busy = $state(false);
  let editingTags = $state(false);
  /** @type {HTMLTextAreaElement | undefined} */
  let replyBox = $state();

  // A new draft gets the cursor immediately.
  $effect(() => {
    // A card on the margin stays hidden until MarginRail moves it next to its fragment, and a
    // hidden field cannot take focus: wait for that layout. preventScroll: focusing must never
    // scroll the reader to wherever the card momentarily is (that used to jump to the paper's top).
    if (isDraft) focusReplyBox();
  });
  // After the first comment the draft card is replaced by this one: the cursor moves to "Ответить…".
  $effect(() => {
    if (note && notes.focusReply === note.id && replyBox) {
      notes.focusReply = null;
      focusReplyBox();
    }
  });

  function focusReplyBox() {
    tick().then(() => requestAnimationFrame(() => requestAnimationFrame(() => replyBox?.focus({ preventScroll: true }))));
  }

  async function send() {
    const body = reply.trim();
    if (!body || busy) return;
    busy = true;
    if (isDraft) await submitDraft(body);
    else if (note) await addComment(note.id, body);
    busy = false;
    reply = '';
  }

  function cancel() {
    reply = '';
    if (isDraft) notes.draft = null;
    else notes.activeId = null;
    onclose?.();
  }

  /** @param {KeyboardEvent} e */
  function replyKey(e) {
    // As in messengers: Enter sends, Shift+Enter starts a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }

  /** @param {import('../lib/api.js').NoteComment} c */
  function startEdit(c) {
    editingId = c.id;
    editText = c.body;
  }
  async function saveEdit() {
    if (!note || editingId === null || !editText.trim()) return;
    await editComment(note.id, editingId, editText.trim());
    editingId = null;
  }

  /** Internal links (2:5.10) inside comments navigate in-app. @param {MouseEvent} e */
  function onClick(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const a = target.closest('a[data-internal]');
    if (a) {
      e.preventDefault();
      navigate(a.getAttribute('href') ?? '/');
      return;
    }
    const tag = target.closest('.comment-body .tag');
    if (tag) {
      showNotesForTag(tag.textContent ?? '');
      return;
    }
    if (note && notes.activeId !== note.id) {
      notes.activeId = note.id;
      // Like Google Docs: activating a card puts the cursor into its reply box — unless the click
      // was on a control or the reader is selecting text in the card.
      if (can.comment && !target.closest('button, a, input, textarea') && getSelection()?.isCollapsed !== false) focusReplyBox();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="note-card" class:active class:resolved={note?.resolved} onclick={onClick}>
  <div class="note-head">
    {#if note?.color}
      <span class="note-color"><span class="dot" data-color={note.color}></span>{colorName(note.color)}</span>
    {/if}
    {#if note?.bookmark}<span class="note-bookmark" title="Закладка"><Icon name="bookmark" size={13} />{note.title ?? ''}</span>{/if}
    {#if note?.resolved}<span class="note-resolved">Решено</span>{/if}
    <span class="spacer"></span>
    {#if note && can.edit}
      <button class="icon-btn small-btn tag-btn" class:on={editingTags} title="Теги" aria-label="Теги"
        onclick={(e) => (e.stopPropagation(), (editingTags = !editingTags))}>#</button>
      <button class="icon-btn small-btn" title={note.resolved ? 'Открыть снова' : 'Решено'}
        aria-label={note.resolved ? 'Открыть снова' : 'Отметить как решённое'}
        onclick={(e) => (e.stopPropagation(), patchNote(note.id, { resolved: !note.resolved }))}>
        {#if note.resolved}<Icon name="history" />{:else}<span class="check">✓</span>{/if}
      </button>
      {#if can.own || note.authorId === session.user?.id}
        <button class="icon-btn small-btn" class:danger={confirmDelete}
          title={confirmDelete ? 'Нажмите ещё раз, чтобы удалить заметку' : 'Удалить заметку'} aria-label="Удалить заметку"
          onclick={(e) => (e.stopPropagation(), confirmDelete ? deleteNote(note.id) : (confirmDelete = true))}
          onblur={() => (confirmDelete = false)}><Icon name="trash" /></button>
      {/if}
    {/if}
    {#if onclose}
      <button class="icon-btn small-btn" aria-label="Закрыть" onclick={(e) => (e.stopPropagation(), onclose())}><Icon name="close" /></button>
    {/if}
  </div>

  {#if note && editingTags}
    <TagInput value={note.tags} onchange={(names) => setNoteTags(note.id, names)} autofocus />
  {:else if note?.tags.length}
    <div class="tag-chips">
      {#each note.tags as name (name)}
        <button class="tag-chip" data-color={tagColor(name)} title="Все заметки с этим тегом"
          onclick={(e) => (e.stopPropagation(), showNotesForTag(name))}>#{name}</button>
      {/each}
    </div>
  {/if}

  {#if showQuote && quote}
    <div class="note-quote">{ref} · {quote}</div>
  {:else if showQuote}
    <div class="note-quote">Абзац {ref}</div>
  {/if}

  {#if note?.comments.length}
    <!-- Comments as a Telegram conversation: own on the right, runs of one author, time in the bubble. -->
    <div class="tg compact note-tg">
      {#each note.comments as c, i (c.id)}
        {@const mine = c.authorId === session.user?.id}
        {@const prev = note.comments[i - 1]}
        {@const next = note.comments[i + 1]}
        <div class="tg-row" class:own={mine} class:first={!prev || prev.authorId !== c.authorId} class:last={!next || next.authorId !== c.authorId}>
          <div class="tg-bubble" class:tail={!next || next.authorId !== c.authorId}>
            {#if showAuthors && !mine && (!prev || prev.authorId !== c.authorId)}
              <div class="tg-name" style:color={userColor(c.authorId)}>{c.authorName ?? 'Участник'}</div>
            {/if}
            {#if editingId === c.id}
              <textarea class="tg-edit" bind:value={editText} rows="3" use:blurOnRemove
                onkeydown={(e) => (e.key === 'Enter' && !e.shiftKey ? (e.preventDefault(), saveEdit()) : e.key === 'Escape' && (editingId = null))}></textarea>
              <div class="tg-edit-actions">
                <button class="link-btn small" onclick={() => (editingId = null)}>Отмена</button>
                <button class="link-btn small" onclick={saveEdit}>Сохранить</button>
              </div>
            {:else}
              <div class="comment-body tg-text">{@html renderBody(c.body)}<span class="tg-meta-space"></span></div>
            {/if}
            <span class="tg-meta" title={formatTime(c.createdAt)}>
              {#if c.updatedAt !== c.createdAt}<span>изм.</span>{/if}
              {new Date(c.createdAt.replace(' ', 'T') + 'Z').toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {#if active && editingId !== c.id && (mine || can.own)}
              <span class="note-msg-actions">
                {#if mine}<button class="icon-btn small-btn" aria-label="Изменить" title="Изменить" onclick={() => startEdit(c)}><Icon name="edit" /></button>{/if}
                <button class="icon-btn small-btn" aria-label="Удалить комментарий" title="Удалить комментарий"
                  onclick={() => note && deleteComment(note.id, c.id)}><Icon name="trash" /></button>
              </span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if active && editingId === null && can.comment}
    <div class="tg-input-row note-input">
      <textarea
        use:blurOnRemove
        bind:this={replyBox}
        bind:value={reply}
        rows="1"
        placeholder={note?.comments.length ? 'Ответить…' : 'Комментарий… (**жирный**, *курсив*, 2:5.10, #тег)'}
        onkeydown={replyKey}
        oninput={(e) => {
          const t = /** @type {HTMLTextAreaElement} */ (e.currentTarget);
          t.style.height = 'auto';
          t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
        }}
      ></textarea>
      <button class="tg-send" class:ready={reply.trim().length > 0} disabled={!reply.trim() || busy} onclick={send} aria-label="Отправить" title="Отправить (Enter)">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
      </button>
    </div>
    {#if isDraft}
      <div class="row-end"><button class="link-btn small" onclick={cancel}>Отмена</button></div>
    {/if}
  {/if}
</div>
