// @ts-check
// Pinching two fingers over a text changes its font size (touch screens): spreading — larger,
// pinching — smaller, live, within the setting's range. The text under the fingers stays where it is.
// The browser's own page zoom is off on the node (touch-action), so the gesture is ours.

/**
 * @typedef {{ get: () => number, set: (px: number) => void, min: number, max: number, anchor?: string, enabled?: boolean }} PinchOptions
 * `anchor`: what to keep in place while the size changes (the paragraph, the message under the fingers);
 * `enabled`: off — the gesture is the browser's again.
 * @param {HTMLElement} node the scrolling element @param {PinchOptions} opts
 */
export function pinchFont(node, opts) {
  let o = opts;
  let d0 = 0, s0 = 0;
  /** @type {Element | null} */ let anchor = null;
  let top = 0;
  const on = () => o.enabled ?? true;
  const mark = () => (node.style.touchAction = on() ? 'pan-x pan-y' : '');
  mark();

  /** @param {TouchList} t */
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  /** @param {TouchEvent} e */
  function start(e) {
    if (e.touches.length !== 2 || !on()) return;
    mark();
    d0 = dist(e.touches);
    s0 = o.get();
    const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    anchor = document.elementFromPoint(x, y)?.closest(o.anchor ?? '*') ?? null;
    top = anchor?.getBoundingClientRect().top ?? 0;
  }
  /** @param {TouchEvent} e */
  function move(e) {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    const size = Math.max(o.min, Math.min(o.max, Math.round(s0 * (dist(e.touches) / d0))));
    if (size === o.get()) return;
    o.set(size);
    // after the new size is laid out, the same text goes back under the fingers
    requestAnimationFrame(() => {
      if (!anchor?.isConnected) return;
      node.scrollTop += anchor.getBoundingClientRect().top - top;
    });
  }
  /** @param {TouchEvent} e */
  function end(e) {
    if (e.touches.length < 2) d0 = 0;
  }
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end, { passive: true });
  node.addEventListener('touchcancel', end, { passive: true });
  return {
    /** @param {PinchOptions} next */
    update(next) {
      o = next;
      mark();
    },
    destroy() {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    },
  };
}
