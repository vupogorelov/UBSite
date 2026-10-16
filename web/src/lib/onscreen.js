// @ts-check

/**
 * The first paragraph of the reader whose bottom is below `offset` px from the scroller's top (the
 * phone's header covers the text there) and how far the screen is into the paper: a fractional
 * paragraph index (the number of paragraphs at the very end).
 * @param {ParentNode} article @param {HTMLElement} scroller @param {number} offset
 * @returns {{ el: HTMLElement, ref: string, index: number, inside: number, count: number } | null}
 */
export function firstParagraph(article, scroller, offset) {
  const list = /** @type {HTMLElement[]} */ ([...article.querySelectorAll('.pair[id^="p-"]')]);
  if (!list.length) return null;
  const top = scroller.getBoundingClientRect().top + offset;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].getBoundingClientRect().bottom <= top) lo = mid + 1;
    else hi = mid;
  }
  const box = list[lo].getBoundingClientRect();
  const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  const inside = atEnd ? list.length : lo + Math.min(1, Math.max(0, (top - box.top) / (box.height || 1)));
  return { el: list[lo], ref: list[lo].id.slice(2), index: lo, inside, count: list.length };
}
