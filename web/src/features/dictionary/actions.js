// @ts-check
// The dictionary's text action (lib/text-actions.js lists it).
import { openWhatIs } from './whatis.svelte.js';
import { book } from '../../lib/lang.svelte.js';

/** «Что это?»: the article of the selected words. @type {import('../../lib/text-actions.js').TextAction} */
export const whatIsAction = {
  id: 'whatis', icon: 'dictionary', dock: 2,
  when: (c) => c.tb.mode !== 'para' && c.tb.text.trim().length > 1,
  label: () => 'Что это?',
  title: () => 'Что это? — словарь книги',
  short: () => true,
  run(c) {
    void openWhatIs(c.tb.text, c.tb.anchor.lang ?? book.main);
    getSelection()?.removeAllRanges();
    c.close();
  },
};
