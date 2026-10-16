// @ts-check
// What can be done with selected text or a whole paragraph, in one list: the panel of text actions
// (SelectionToolbar.svelte) shows each action that applies, in this order on a computer and in its own
// order (`dock`) on a phone or tablet. A new action ("Спросить книгу"…) = an item here.
//
// An action is a button (`run`) or a component with a popover of its own (`component`: «В подборку»,
// «Задача»). The panel gives each the same context: what is selected, the note on it, the person's rights.
import { tick } from 'svelte';
import { notes, createNote, patchNote, citation } from './notes.svelte.js';
import { placeLink, shareLink } from './share.js';
import { openQuoteCard } from './quotecard.svelte.js';
import { book } from './lang.svelte.js';
import { can, session } from './session.svelte.js';
import AddToCollection from '../components/AddToCollection.svelte';
import AddTask from '../components/AddTask.svelte';

/**
 * @typedef {{
 *   tb: import('./notes.svelte.js').ToolbarState,
 *   note: import('./api.js').Note | null,
 *   docked: boolean,
 *   panel: { tagging: boolean },
 *   close: () => void, translate: () => void, thread: () => void,
 * }} ActionContext
 * `note`: the note on the selection (null — none yet); `docked`: the phone's panel at an edge (labels
 * shown); `panel`: what the panel opens below its row (the tags); `translate`, `thread`: the reader's.
 */

/**
 * @typedef {{
 *   id: string,
 *   when: (c: ActionContext) => boolean,
 *   dock?: number,
 *   publicLayer?: boolean,
 *   icon?: import('./icon-names.js').IconName,
 *   label?: (c: ActionContext) => string,
 *   title?: (c: ActionContext) => string,
 *   short?: (c: ActionContext) => boolean,
 *   on?: (c: ActionContext) => boolean,
 *   fill?: boolean,
 *   count?: (c: ActionContext) => number,
 *   run?: (c: ActionContext) => unknown,
 *   component?: any,
 *   props?: (c: ActionContext) => Record<string, unknown>,
 * }} TextAction
 * `dock`: the place on a phone (smaller first); `publicLayer`: the public layer's (after a separator);
 * `short`: the label only on a phone (the computer's floating panel shows the icon); `on`: lit; `fill`: its
 * icon filled when lit (a bookmark set).
 */

const para = (/** @type {ActionContext} */ c) => c.tb.mode === 'para';
/** The selected quote's place (null — the whole paragraph). @param {ActionContext} c */
const quoteOf = (c) => {
  const { lang, start, end } = c.tb.anchor;
  return !para(c) && lang !== null && start !== null && end !== null ? { lang, start, end } : null;
};

/** @type {TextAction[]} */
export const TEXT_ACTIONS = [
  {
    id: 'comment', icon: 'comment', dock: 1,
    when: () => can.comment,
    label: () => 'Комментарий', title: () => 'Комментарий',
    run(c) {
      if (c.note && c.note.comments.length) notes.activeId = c.note.id;
      else {
        notes.draft = { ...c.tb.anchor, noteId: c.note?.id ?? null };
        notes.activeId = c.note?.id ?? null;
      }
      getSelection()?.removeAllRanges();
      c.close();
    },
  },
  {
    // a bookmark: its name (by default the first words of its sentence, set by the server) and, for a
    // fragment of text, its color — yellow at first, can be changed or removed (the panel, below its row)
    id: 'bookmark', icon: 'bookmark', dock: 5, fill: true,
    when: () => can.edit,
    label: () => 'Закладка', title: (c) => (c.note?.bookmark ? 'Убрать закладку' : 'Закладка'), short: () => true,
    on: (c) => !!c.note?.bookmark,
    async run(c) {
      const fragment = c.tb.anchor.lang !== null;
      if (c.note?.bookmark) await patchNote(c.note.id, { bookmark: false }); // the color goes with it
      else {
        if (c.note) await patchNote(c.note.id, fragment && !c.note.color ? { bookmark: true, color: 'yellow' } : { bookmark: true });
        else {
          const created = await createNote(c.tb.anchor, fragment ? { bookmark: true, color: 'yellow' } : { bookmark: true });
          if (created) c.tb.noteId = created.id;
        }
        // a new bookmark: the cursor goes to its name (the suggested one is selected — typing replaces it)
        await tick();
        /** @type {HTMLInputElement | null} */ (document.querySelector('.sel-title'))?.focus();
      }
      getSelection()?.removeAllRanges();
    },
  },
  {
    id: 'tags', icon: 'tag', dock: 6,
    when: () => can.edit,
    label: () => 'Метки', title: () => 'Теги', short: () => true,
    on: (c) => c.panel.tagging || (c.note?.tags.length ?? 0) > 0,
    count: (c) => c.note?.tags.length ?? 0,
    run: (c) => void (c.panel.tagging = !c.panel.tagging),
  },
  {
    // the paragraph, the note, or the paragraph pointing at the selected fragment
    id: 'collection', dock: 7,
    when: () => can.edit,
    component: AddToCollection,
    props: (c) => ({
      label: para(c) || c.docked,
      ondone: c.close,
      item: () => {
        const { ref, lang, start, end } = c.tb.anchor;
        return para(c) ? { kind: 'para', ref }
          : c.note ? { kind: 'note', annotationId: c.note.id }
          : lang !== null && start !== null && end !== null ? { kind: 'para', ref, fragment: { lang, start, end } }
          : { kind: 'para', ref };
      },
    }),
  },
  {
    // a task tied to the paragraph, or to the note when there is one
    id: 'task', dock: 8,
    when: () => !!session.user,
    component: AddTask,
    props: (c) => ({
      label: para(c) || c.docked,
      ondone: c.close,
      link: () => (c.note ? { ref: c.tb.anchor.ref, annotationId: c.note.id } : { ref: c.tb.anchor.ref }),
      suggest: para(c) ? `Абзац ${c.tb.anchor.ref}: ` : `«${c.tb.text.length > 80 ? c.tb.text.slice(0, 80) + '…' : c.tb.text}» — `,
    }),
  },
  {
    // the public link to the quote (or the paragraph) — anyone opens it, signed in or not (lib/share.js)
    id: 'copy', icon: 'link', dock: 4,
    when: () => true,
    label: () => 'Ссылка',
    title: (c) => (para(c) ? 'Ссылка на абзац — откроется у любого' : 'Цитата со ссылкой — откроется у любого'),
    short: () => can.comment,
    run(c) {
      const { ref, lang } = c.tb.anchor;
      const quote = quoteOf(c);
      void shareLink(placeLink(ref, quote), quote ? citation(c.tb.text, ref, lang) : undefined, quote ? 'Цитата со ссылкой скопирована' : `Ссылка на ${ref} скопирована`);
      c.close();
    },
  },
  {
    // the quote (or the paragraph) drawn as a picture to send (QuoteImage.svelte)
    id: 'picture', icon: 'image', dock: 0,
    when: () => true,
    label: () => 'Картинка',
    title: (c) => (para(c) ? 'Абзац картинкой — отправить в мессенджер' : 'Цитата картинкой — отправить в мессенджер'),
    short: () => true,
    run(c) {
      const { ref, lang } = c.tb.anchor;
      openQuoteCard({ text: c.tb.text, lang: lang ?? book.main, ref, link: placeLink(ref, quoteOf(c)) });
      getSelection()?.removeAllRanges();
      c.close();
    },
  },
  {
    // a variant of translation: the public layer, about the Russian text
    id: 'translate', icon: 'translate', dock: 3, publicLayer: true,
    when: (c) => !!session.user && ((para(c) && book.main === 'ru') || c.tb.anchor.lang === 'ru'),
    label: (c) => (para(c) ? 'Перевести абзац' : 'Перевести'),
    title: () => 'Предложить свой вариант перевода — публичный слой',
    run: (c) => c.translate(),
  },
  {
    // the paragraph's thread in the chat; a selected fragment goes into the input as a quote
    id: 'discuss', icon: 'discuss', dock: 2,
    when: () => true,
    label: () => 'Обсудить',
    title: (c) => (para(c) ? 'Обсудить абзац в чате' : 'Обсудить фрагмент в чате абзаца'),
    short: (c) => !para(c) && !c.docked,
    run: (c) => c.thread(),
  },
];
