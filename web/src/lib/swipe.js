// @ts-check
// Close a panel by swiping it away (touch screens): the panel follows the finger and closes past a
// threshold or on a quick flick, otherwise it springs back. "down" starts only when the content
// under the finger is scrolled to its top; sliders, fields and sideways-scrolling rows are left alone.

/**
 * @typedef {{ dirs: ('down' | 'right')[], onclose: () => void }} SwipeOptions
 * @param {HTMLElement} node @param {SwipeOptions} opts
 */
export function swipeClose(node, opts) {
  let o = opts;
  let x0 = 0, y0 = 0, t0 = 0;
  /** @type {'down' | 'right' | null | false} null — not decided yet, false — not ours */
  let axis = null;
  let d = 0;

  /** Is any element between the target and the panel scrolled away from its top? @param {EventTarget | null} target */
  const scrolledDown = (target) => {
    for (let el = /** @type {HTMLElement | null} */ (target); el && el !== node.parentElement; el = el.parentElement) {
      if (el.scrollTop > 0) return true;
    }
    return false;
  };
  /** @param {EventTarget | null} target */
  const sideScroller = (target) => {
    for (let el = /** @type {HTMLElement | null} */ (target); el && el !== node.parentElement; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };

  /** @param {TouchEvent} e */
  function start(e) {
    const t = /** @type {HTMLElement} */ (e.target);
    if (e.touches.length !== 1 || t.closest('input, select, textarea, [contenteditable]')) {
      axis = false;
      return;
    }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    t0 = Date.now();
    axis = null;
    d = 0;
  }
  /** @param {TouchEvent} e */
  function move(e) {
    if (axis === false) return;
    const dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (axis === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (o.dirs.includes('down') && dy > 0 && dy > Math.abs(dx) && !scrolledDown(e.target)) axis = 'down';
      else if (o.dirs.includes('right') && dx > 0 && dx > Math.abs(dy) * 1.5 && !sideScroller(e.target)) axis = 'right';
      else {
        axis = false;
        return;
      }
      node.style.transition = 'none';
    }
    d = Math.max(0, axis === 'down' ? dy : dx);
    node.style.transform = axis === 'down' ? `translateY(${d}px)` : `translateX(${d}px)`;
    e.preventDefault();
  }
  function end() {
    if (!axis) return;
    const size = axis === 'down' ? node.offsetHeight : node.offsetWidth;
    const fast = d / Math.max(1, Date.now() - t0) > 0.6 && d > 30;
    node.style.transition = 'transform 0.18s ease';
    if (fast || d > Math.min(120, size / 3)) {
      node.style.transform = axis === 'down' ? 'translateY(100%)' : 'translateX(100%)';
      setTimeout(() => {
        o.onclose();
        node.style.transform = '';
        node.style.transition = '';
      }, 160);
    } else {
      node.style.transform = '';
      setTimeout(() => (node.style.transition = ''), 200);
    }
    axis = null;
  }

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
  return {
    /** @param {SwipeOptions} next */
    update(next) {
      o = next;
    },
    destroy() {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    },
  };
}
