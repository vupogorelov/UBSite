<script>
  import { tick } from 'svelte';
  import {
    notes, colorName, submitDraft, addComment, editComment, deleteComment, reactComment, patchNote, deleteNote, setNoteTags,
  } from '../lib/notes.svelte.js';
  import { renderBody } from '../lib/markup.js';
  import { navigate } from '../lib/router.svelte.js';
  import { tagColor } from '../lib/tags.svelte.js';
  import { showNotesForTag } from '../lib/ui.svelte.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';
  import ChatMessages from './ChatMessages.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import { can, session } from '../lib/session.svelte.js';
  import { chat, sendTyping } from '../lib/chat.svelte.js';
  import { REACTIONS } from '../../../shared/reactions.js';

  /**
   * A note's card. Its comments are the note's conversation ("note:<id>") drawn as in the chat:
   * replies with a quote, reactions, @mentions, "печатает…". `note` is an existing annotation;
   * without it the card edits notes.draft. `onactions`: "⋯" — the note's actions (the reader's panel of
   * text actions takes the card's place for a while).
   * @type {{ note?: import('../lib/api.js').Note, showQuote?: boolean, onclose?: () => void, onactions?: () => void }}
   */
  let { note, showQuote = false, onclose, onactions } = $props();

  const isDraft = $derived(!note);
  const active = $derived(isDraft || notes.activeId === note?.id);
  const quote = $derived(note ? note.quote : notes.draft?.quote ?? null);
  const ref = $derived(note?.ref ?? notes.draft?.ref ?? '');
  const key = $derived(note ? `note:${note.id}` : null);
  const typing = $derived(key ? chat.typing[key] : null);

  /** @type {{ id: number, authorName: string | null, body: string } | null} */
  let reply = $state(null);
  let confirmDelete = $state(false);
  let editingTags = $state(false);
  /** @type {ChatComposer | undefined} */
  let composer = $state();

  // A new draft gets the cursor immediately.
  $effect(() => {
    // A card on the margin stays hidden until MarginRail moves it next to its fragment, and a
    // hidden field cannot take focus: wait for that layout. preventScroll: focusing must never
    // scroll the reader to wherever the card momentarily is (that used to jump to the paper's top).
    if (isDraft) focusReplyBox();
  });
  // After the first comment the draft card is replaced by this one: the cursor moves to "Ответить…".
  $effect(() => {
    if (note && notes.focusReply === note.id && composer) {
      notes.focusReply = null;
      focusReplyBox();
    }
  });

  function focusReplyBox() {
    tick().then(() => requestAnimationFrame(() => requestAnimationFrame(() => composer?.focus({ preventScroll: true }))));
  }

  /** Enter sends (Shift+Enter — a new line), as in the chat. @param {string} body */
  async function send(body) {
    if (isDraft) return submitDraft(body);
    if (!note) return false;
    const sent = await addComment(note.id, body, reply?.id ?? null);
    if (sent) reply = null;
    return !!sent;
  }

  function cancel() {
    reply = null;
    if (isDraft) notes.draft = null;
    else notes.activeId = null;
    onclose?.();
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
    {#if note && onactions}
      <button class="icon-btn small-btn" title="Действия с заметкой" aria-label="Действия с заметкой"
        onclick={(e) => (e.stopPropagation(), onactions())}><Icon name="dots" /></button>
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
    <!-- The note's conversation, as in the chat: replies (double click / right click / long press),
         reactions, edits; own on the right. Names only where several people write. -->
    <div class="note-tg">
      <ChatMessages compact messages={note.comments} me={session.user?.id ?? null} reactions={REACTIONS} render={renderBody}
        candeleteall={can.own} chatKey={key}
        onreply={can.comment ? (m) => ((reply = { id: m.id, authorName: m.authorName, body: m.body.slice(0, 200) }), (notes.activeId = note.id)) : undefined}
        onreact={(m, emoji) => note && reactComment(note.id, m.id, emoji)}
        onedit={(m, body) => (note ? editComment(note.id, m.id, body) : Promise.resolve(null))}
        ondelete={(m) => note && deleteComment(note.id, m.id)} />
    </div>
  {/if}
  {#if typing}<div class="note-typing muted small">{typing.name} печатает…</div>{/if}

  {#if active && can.comment}
    <div class="note-input">
      <ChatComposer bind:this={composer} onsend={send} {reply} oncancelreply={() => (reply = null)} onescape={cancel}
        chatKey={key} ontyping={() => key && sendTyping(key)}
        placeholder={note?.comments.length ? 'Ответить…' : 'Комментарий… (**жирный**, *курсив*, 2:5.10, #тег, @имя)'} />
    </div>
    {#if isDraft}
      <div class="row-end"><button class="link-btn small" onclick={cancel}>Отмена</button></div>
    {/if}
  {/if}
</div>
