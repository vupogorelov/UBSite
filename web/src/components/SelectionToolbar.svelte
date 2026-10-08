<script>
  import { tick } from 'svelte';
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { notes, createNote, patchNote, deleteNote, colorName, citation, copyText, setNoteTags } from '../lib/notes.svelte.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';
  import AddToCollection from './AddToCollection.svelte';
  import AddTask from './AddTask.svelte';
  import { device } from '../lib/mobile.svelte.js';
  import { settings } from '../lib/settings.svelte.js';
  import { blurOnRemove } from '../lib/focus.js';
  import { can, session } from '../lib/session.svelte.js';

  /**
   * mode "new": a fresh text selection; "edit": an existing note; "para": a whole paragraph.
   * @typedef {{
   *   mode: 'new' | 'edit' | 'para',
   *   x: number, y: number, below: boolean, cx?: number,
   *   anchor: import('../lib/notes.svelte.js').Anchor,
   *   noteId: number | null,
   *   text: string,
   * }} ToolbarState
   */

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

  /** What "В подборку" adds: the paragraph, the note, or the paragraph with the selected words as the comment. */
  function collectionItem() {
    /** @type {import('../lib/api.js').NewCollectionItem} */
    const item =
      tb.mode === 'para' ? { kind: 'para', ref: tb.anchor.ref }
      : note ? { kind: 'note', annotationId: note.id }
      : { kind: 'para', ref: tb.anchor.ref, body: `«${tb.text}»` };
    return item;
  }

  /** A task is tied to the paragraph, or to the note when there is one. */
  const taskLink = () => (note ? { ref: tb.anchor.ref, annotationId: note.id } : { ref: tb.anchor.ref });
  const taskSuggestion = $derived(
    tb.mode === 'para' ? `Абзац ${tb.anchor.ref}: ` : `«${tb.text.length > 80 ? tb.text.slice(0, 80) + '…' : tb.text}» — `,
  );

  function copy() {
    copyText(citation(tb.text, tb.anchor.ref, tb.anchor.lang));
    onclose();
  }

  async function remove() {
    if (!note) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    await deleteNote(note.id);
    onclose();
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
    <AddTask link={taskLink} suggest={taskSuggestion} ondone={onclose} label={tb.mode === 'para' || docked} />
    <button class="tb-btn tb-copy" onclick={copy} title="Копировать цитату со ссылкой"><Icon name="copy" size={16} />{#if !can.comment}<span>Цитата</span>{:else}<span class="tb-m">Ссылка</span>{/if}</button>
    {#if tb.mode === 'para' || tb.anchor.lang === 'ru'}
      <span class="sep"></span>
      <button class="tb-btn tb-translate" onclick={ontranslate} title="Предложить свой вариант перевода — публичный слой">
        <Icon name="translate" size={16} /><span>{tb.mode === 'para' ? 'Перевести абзац' : 'Перевести'}</span>
      </button>
    {/if}
    {#if tb.mode === 'para' || docked}
      <button class="tb-btn tb-discuss" onclick={onthread} title="Публичное обсуждение абзаца"><Icon name="discuss" size={16} /><span>Обсудить</span></button>
    {/if}
    {#if note && (can.own || (can.edit && note.authorId === session.user?.id))}
      <button class="icon-btn small-btn tb-delete" class:danger={confirmDelete} onclick={remove}
        title={confirmDelete ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить заметку'} aria-label="Удалить заметку"><Icon name="trash" /></button>
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
