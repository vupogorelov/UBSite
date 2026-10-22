// @ts-check
// A change of place and size animated by the GPU alone (FLIP: first, last, invert, play): the new layout is laid
// once, then each element is given its old look back by a transform and let go of it — the frames between are
// the compositor's (transform only), no layout per frame. Used for the bottom bar shrinking while reading.

/** Where the elements are now. @param {Element[]} els @returns {[Element, DOMRect][]} */
export function measure(els) {
  return els.map((el) => [el, el.getBoundingClientRect()]);
}

/**
 * From where they were (`before`) to where they are now, by transform. `scale` false: moved only, by their centres
 * (what holds icons: a scale unequal across and down would squash them).
 * @param {[Element, DOMRect][]} before @param {{ ms?: number, scale?: boolean }} [opts]
 */
export function play(before, { ms = 250, scale = true } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const [el, a] of before) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || !a.width || !a.height) continue;
    const dx = scale ? a.left - b.left : a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = scale ? a.top - b.top : a.top + a.height / 2 - (b.top + b.height / 2);
    const sx = scale ? a.width / b.width : 1;
    const sy = scale ? a.height / b.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue;
    el.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: ms, easing: 'ease' },
    );
  }
}
