// @ts-check
// The book's map, loaded once from the contents (lib/bookindex.js does the arithmetic): the reading and
// listening progress is a share of the book, seeking along the whole book turns a share into a place.
// The progress line waits for it (`bookMap.ready`).
import { api } from './api.js';
import { indexOf, shareIn, placeIn } from './bookindex.js';

/** @type {import('./bookindex.js').BookIndex | null} */
let book = null;
let loading = false;
/** The paragraph map of the book is loaded. */
export const bookMap = $state({ ready: false });

export function loadBook() {
  if (book || loading) return;
  loading = true;
  api.toc().then(
    (t) => {
      book = indexOf(t);
      bookMap.ready = true;
    },
    () => (loading = false),
  );
}

/** The map is there (seeking along the book is possible). */
export const bookLoaded = () => book !== null;

/** The share of the book before paragraph `idx` of `paper` (null until the map is loaded). @param {number} paper @param {number} idx */
export const bookShare = (paper, idx) => shareIn(book, paper, idx);

/** The paper and its paragraph at a share of the book. @param {number} frac */
export const locate = (frac) => placeIn(book, frac);
