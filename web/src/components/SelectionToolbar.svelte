<script>
  import { book } from '../lib/lang.svelte.js';
  import { tick } from 'svelte';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { notes, createNote, patchNote, deleteNote, colorName, citation, setNoteTags } from '../lib/notes.svelte.js';
  import { placeLink, shareLink } from '../lib/share.js';
  import { openQuoteCard } from '../lib/quotecard.svelte.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';
  import AddToCollection from './AddToCollection.svelte';
  import AddTask from './AddTask.svelte';
  import { device } from '../lib/mobile.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { blurOnRemove } from '../lib/focus.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { can, session } from '../lib/session.svelte.js';

  /** @typedef {import('../lib/notes.svelte.js').ToolbarState} ToolbarState */

  /** @type {{ tb: ToolbarState, onclose: () => void, ontranslate: () => void, onthread: () => void }} */
  let { tb, onclose, ontranslate, onthread } = $props();

  // Phone and tablet: the panel is docked to an edge of the screen (Настройки → «Меню действий с текстом»);
  // "side" takes the edge away from the selection.
  const docked = $derived(device.mobile || device.touch);
  const dock = $derived(!docked ? null : settings.textActions === 'side' ? ((tb.cx ?? tb.x) < innerWidth / 2 ? 'right' : 'left') : settings.textActions);

  const note = $derived(tb.noteId === null ? null : notes.items.find((n) => n.id === tb.noteId) ?? null);
  let confirmDelete = $state(false);
  let tagging = $state(false);

  /** @param {string[]} names */
  async function changeTags(names) {
    if (note) {
      const res = await setNoteTags(note.id, names);
      if (!res) tb.noteId = null; // the note had nothing else and was removed
    } else if (names.length) {
      const created = await createNote(tb.anchor, { tags: names });
      if (created) tb.noteId = created.id;
    }
  }

  /** A bookmark's color (only for a fragment of text): one of the workspace colors or none. @param {import('../lib/api.js').NoteColor | null} color */
  async function pickColor(color) {
    if (note) await patchNote(note.id, { color });
  }

  function comment() {
    if (note && note.comments.length) {
      notes.activeId = note.id;
    } else {
      notes.draft = { ...tb.anchor, noteId: note?.id ?? null };
      notes.activeId = note?.id ?? null;
    }
    getSelection()?.removeAllRanges();
    onclose();
  }

  // A bookmark: its name (by default the first words of its sentence, set by the server) and, for a
  // fragment of text, its color — yellow at first, can be changed or removed.
  const fragment = $derived(tb.anchor.lang !== null);
  async function toggleBookmark() {
    if (note?.bookmark) {
      await patchNote(note.id, { bookmark: false }); // the color goes with it
    } else {
      if (note) await patchNote(note.id, fragment && !note.color ? { bookmark: true, color: 'yellow' } : { bookmark: true });
      else {
        const created = await createNote(tb.anchor, fragment ? { bookmark: true, color: 'yellow' } : { bookmark: true });
        if (created) tb.noteId = created.id;
      }
      // A new bookmark: the cursor goes to its name (the suggested one is selected — typing replaces it).
      await tick();
      /** @type {HTMLInputElement | null} */ (document.querySelector('.sel-title'))?.focus();
    }
    getSelection()?.removeAllRanges();
  }

  /** @param {Event} e */
  function saveTitle(e) {
    const value = /** @type {HTMLInputElement} */ (e.currentTarget).value.trim();
    if (note && value !== (note.title ?? '')) patchNote(note.id, { title: value || null });
  }

  /** What "В подборку" adds: the paragraph, the note, or the paragraph pointing at the selected fragment. */
  function collectionItem() {
    const { ref, lang, start, end } = tb.anchor;
    /** @type {import('../lib/api.js').NewCollectionItem} */
    const item =
      tb.mode === 'para' ? { kind: 'para', ref }
      : note ? { kind: 'note', annotationId: note.id }
      : lang !== null && start !== null && end !== null ? { kind: 'para', ref, fragment: { lang, start, end } }
      : { kind: 'para', ref };
    return item;
  }

  /** A task is tied to the paragraph, or to the note when there is one. */
  const taskLink = () => (note ? { ref: tb.anchor.ref, annotationId: note.id } : { ref: tb.anchor.ref });
  const taskSuggestion = $derived(
    tb.mode === 'para' ? `Абзац ${tb.anchor.ref}: ` : `«${tb.text.length > 80 ? tb.text.slice(0, 80) + '…' : tb.text}» — `,
  );

  /** «Ссылка»: the public link to the quote (or the paragraph) — anyone opens it, signed in or not (lib/share.js). */
  function share() {
    const { ref, lang, start, end } = tb.anchor;
    const quote = tb.mode !== 'para' && lang !== null && start !== null && end !== null ? { lang, start, end } : null;
    void shareLink(placeLink(ref, quote), quote ? citation(tb.text, ref, lang) : undefined, quote ? 'Цитата со ссылкой скопирована' : `Ссылка на ${ref} скопирована`);
    onclose();
  }

  /** «Картинка»: the quote (or the paragraph) drawn as a picture to send (QuoteImage.svelte). */
  function picture() {
    const { ref, lang, start, end } = tb.anchor;
    const quote = tb.mode !== 'para' && lang !== null && start !== null && end !== null ? { lang, start, end } : null;
    openQuoteCard({ text: tb.text, lang: lang ?? book.main, ref, link: placeLink(ref, quote) });
    getSelection()?.removeAllRanges();
    onclose();
  }

  // The bin: a note without a conversation goes at once, with «Вернуть» for a few seconds (its place,
  // bookmark, color, name and tags come back); one with comments asks first — a conversation (others'
  // words too) cannot be brought back.
  async function remove() {
    if (!note) return;
    if (note.comments.length && !confirmDelete) {
      confirmDelete = true;
      return;
    }
    const n = note;
    await deleteNote(n.id);
    onclose();
    if (!n.comments.length) {
      /** @type {any} */
      // (plain values: the queue keeps the change in IndexedDB, which takes no reactive proxies)
      const props = { bookmark: n.bookmark, color: n.color ?? undefined, title: n.title, tags: [...n.tags] };
      showToast(n.bookmark ? 'Закладка удалена' : 'Заметка удалена', {
        label: 'Вернуть',
        run: () => void createNote({ ref: n.ref, lang: n.lang, start: n.start, end: n.end, quote: n.quote }, props),
      });
    }
  }
</script>

<!-- Keep the text selection alive: mousedown on the toolbar must not clear it. -->
<div
  class="sel-toolbar"
  class:below={tb.below}
  class:docked={dock !== null}
  class:dock-top={dock === 'top'}
  class:dock-bottom={dock === 'bottom'}
  class:dock-left={dock === 'left'}
  class:dock-right={dock === 'right'}
  style:left="{tb.x}px"
  style:top="{tb.y}px"
  role="toolbar"
  aria-label="Действия с выделенным текстом"
  tabindex="-1"
  onmousedown={(e) => !['INPUT', 'SELECT', 'OPTION', 'TEXTAREA'].includes(/** @type {HTMLElement} */ (e.target).tagName) && e.preventDefault()}
>
  {#if docked}
    <!-- Phone, tablet: a docked panel with a header (what is selected) and labelled 48 px actions. -->
    <div class="sel-mhead">
      <span class="ellipsis">{tb.mode === 'para' ? `Абзац ${tb.anchor.ref}` : `«${tb.text}»`}</span>
      <button class="icon-btn small-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
    </div>
  {/if}
  <div class="sel-row">
    {#if can.comment}
      <button class="tb-btn tb-comment" onclick={comment} title="Комментарий"><Icon name="comment" size={16} /><span>Комментарий</span></button>
    {/if}
    {#if can.edit}
      <button class="tb-btn tb-bookmark" class:on={note?.bookmark} class:bookmarked={note?.bookmark} onclick={toggleBookmark} title={note?.bookmark ? 'Убрать закладку' : 'Закладка'}><Icon name="bookmark" size={16} /><span class="tb-m">Закладка</span></button>
      <button class="tb-btn tb-tags" class:on={tagging || (note?.tags.length ?? 0) > 0} onclick={() => (tagging = !tagging)}
        title="Теги"><Icon name="tag" size={16} /><span class="tb-m">Метки</span>{#if note?.tags.length}<span>{note.tags.length}</span>{/if}</button>
    {/if}
    {#if can.edit}
      <AddToCollection item={collectionItem} ondone={onclose} label={tb.mode === 'para' || docked} />
    {/if}
    {#if session.user}
      <AddTask link={taskLink} suggest={taskSuggestion} ondone={onclose} label={tb.mode === 'para' || docked} />
    {/if}
    <button class="tb-btn tb-copy" onclick={share} title={tb.mode === 'para' ? 'Ссылка на абзац — откроется у любого' : 'Цитата со ссылкой — откроется у любого'}>
      <Icon name="link" size={16} /><span class:tb-m={can.comment}>Ссылка</span></button>
    <button class="tb-btn tb-picture" onclick={picture} title={tb.mode === 'para' ? 'Абзац картинкой — отправить в мессенджер' : 'Цитата картинкой — отправить в мессенджер'}>
      <Icon name="image" size={16} /><span class="tb-m">Картинка</span></button>
    {#if session.user && ((tb.mode === 'para' && book.main === 'ru') || tb.anchor.lang === 'ru')}
      <span class="sep"></span>
      <button class="tb-btn tb-translate" onclick={ontranslate} title="Предложить свой вариант перевода — публичный слой">
        <Icon name="translate" size={16} /><span>{tb.mode === 'para' ? 'Перевести абзац' : 'Перевести'}</span>
      </button>
    {/if}
    <!-- The paragraph's thread in the chat; a selected fragment goes into the input as a quote -->
    <button class="tb-btn tb-discuss" onclick={onthread} title={tb.mode === 'para' ? 'Обсудить абзац в чате' : 'Обсудить фрагмент в чате абзаца'}>
      <Icon name="discuss" size={16} /><span class:tb-m={tb.mode !== 'para' && !docked}>Обсудить</span>
    </button>
    {#if note && (can.own || (can.edit && note.authorId === session.user?.id))}
      <button class="icon-btn small-btn tb-delete" class:danger={confirmDelete} onclick={remove}
        title={confirmDelete ? 'Нажмите ещё раз — заметка удалится вместе с обсуждением' : 'Удалить заметку'} aria-label="Удалить заметку"><Icon name="trash" /></button>
    {/if}
  </div>
  {#if tagging && can.edit}
    <TagInput value={note?.tags ?? []} onchange={changeTags} autofocus />
  {/if}
  {#if note?.bookmark && can.edit}
    <!-- The bookmark: its name, and below — its color (for a fragment of text). -->
    <div class="sel-bm">
      <input class="text-input sel-title" use:blurOnRemove placeholder="Название закладки" value={note.title ?? ''}
        onfocus={(e) => e.currentTarget.select()} onchange={saveTitle}
        onkeydown={(e) => e.key === 'Enter' && /** @type {HTMLInputElement} */ (e.currentTarget).blur()} aria-label="Название закладки" />
      {#if note.lang}
        <div class="sel-colors" role="radiogroup" aria-label="Цвет закладки">
          {#each NOTE_COLORS as [color] (color)}
            <button class="swatch" data-color={color} class:on={note.color === color} title={colorName(color)} role="radio"
              aria-checked={note.color === color} aria-label={`Цвет: ${colorName(color)}`} onclick={() => pickColor(color)}></button>
          {/each}
          <button class="swatch swatch-none" class:on={!note.color} title="Без цвета" role="radio" aria-checked={!note.color}
            aria-label="Без цвета" onclick={() => pickColor(null)}></button>
        </div>
      {/if}
    </div>
  {/if}
</div>
