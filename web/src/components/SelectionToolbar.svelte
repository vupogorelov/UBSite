<script>
  import { NOTE_COLORS } from '../../../shared/settings.js';
  import { notes, createNote, patchNote, deleteNote, colorName, setNoteTags } from '../lib/notes.svelte.js';
  import { TEXT_ACTIONS } from '../lib/text-actions.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';
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
  /** What the panel opens below its row: the tags (the «Метки» action). */
  const panel = $state({ tagging: false });
  /** The actions' context (lib/text-actions.js). @type {import('../lib/text-actions.js').ActionContext} */
  const ctx = $derived({ tb, note, docked, panel, close: onclose, translate: ontranslate, thread: onthread });
  /** The actions that apply here, in the list's order; the public layer's after a separator. */
  const actions = $derived(TEXT_ACTIONS.filter((a) => a.when(ctx)));
  const firstPublic = $derived(actions.find((a) => a.publicLayer)?.id);

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

  /** @param {Event} e */
  function saveTitle(e) {
    const value = /** @type {HTMLInputElement} */ (e.currentTarget).value.trim();
    if (note && value !== (note.title ?? '')) patchNote(note.id, { title: value || null });
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
    {#each actions as a (a.id)}
      {#if a.id === firstPublic}<span class="sep"></span>{/if}
      {#if a.component}
        <a.component {...a.props?.(ctx)} order={docked ? a.dock : undefined} />
      {:else}
        {@const on = a.on?.(ctx) ?? false}
        {@const n = a.count?.(ctx) ?? 0}
        <button class="tb-btn tb-{a.id}" class:on class:bookmarked={a.fill && on} style:order={docked ? a.dock : undefined}
          onclick={() => a.run?.(ctx)} title={a.title?.(ctx)}>
          {#if a.icon}<Icon name={a.icon} size={16} />{/if}<span class:tb-m={a.short?.(ctx) ?? false}>{a.label?.(ctx)}</span>{#if n}<span>{n}</span>{/if}
        </button>
      {/if}
    {/each}
    {#if note && (can.own || (can.edit && note.authorId === session.user?.id))}
      <button class="icon-btn small-btn tb-delete" class:danger={confirmDelete} onclick={remove}
        title={confirmDelete ? 'Нажмите ещё раз — заметка удалится вместе с обсуждением' : 'Удалить заметку'} aria-label="Удалить заметку"><Icon name="trash" /></button>
    {/if}
  </div>
  {#if panel.tagging && can.edit}
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
