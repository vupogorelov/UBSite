// @ts-check
// Close a panel by swiping it away (touch screens): the panel follows the finger and closes past a
// threshold or on a quick flick, otherwise it springs back. "down" starts only when the content
// under the finger is scrolled to its top; sliders, fields and sideways-scrolling rows are left alone.

/**
 * A sideways swipe over an area opens something (over the text: to the left — the book's notes, to the
 * right — search). A clear, quick horizontal stroke only: not from the screen's edges (the system's
 * "back" gesture lives there), not while text is selected or `enabled` says no; vertical scrolling is untouched.
 * @param {HTMLElement} node @param {{ onleft?: () => void, onright?: () => void, enabled?: () => boolean }} opts
 */
export function swipeOpen(node, opts) {
  let o = opts;
  let x0 = 0, y0 = 0, t0 = 0, armed = false;
  const EDGE = 28;
  /** @param {TouchEvent} e */
  function start(e) {
    const t = e.touches[0];
    armed = e.touches.length === 1 && t.clientX > EDGE && t.clientX < innerWidth - EDGE && (o.enabled?.() ?? true)
      && !(/** @type {HTMLElement} */ (e.target).closest('input, select, textarea, button, a, [contenteditable], .tts-panel'));
    x0 = t.clientX;
    y0 = t.clientY;
    t0 = Date.now();
  }
  /** @param {TouchEvent} e */
  function end(e) {
    if (!armed) return;
    armed = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dy) * 1.8 > Math.abs(dx) || Date.now() - t0 > 700) return;
    if (getSelection()?.isCollapsed === false) return; // selecting text, not swiping
    if (dx < 0) o.onleft?.();
    else o.onright?.();
  }
  const cancel = () => (armed = false);
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchend', end, { passive: true });
  node.addEventListener('touchcancel', cancel, { passive: true });
  return {
    /** @param {typeof opts} next */
    update(next) {
      o = next;
    },
    destroy() {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
    },
  };
}

/**
 * A message swiped to the left prepares a reply, like Telegram: the row follows the finger (setting
 * `--swipe-x` in px and `--swipe-p` 0…1 for the CSS), past the threshold it answers on release with a
 * short vibration; a vertical stroke stays a scroll. `onreply` absent — the gesture is off.
 * @param {HTMLElement} node @param {(() => void) | undefined} onreply
 */
export function swipeReply(node, onreply) {
  let fn = onreply;
  const MAX = 80, AT = 56;
  let x0 = 0, y0 = 0, d = 0;
  /** @type {boolean | null} null — not decided yet */
  let mine = null;
  const set = (/** @type {number} */ x) => {
    node.style.setProperty('--swipe-x', `${x}px`);
    node.style.setProperty('--swipe-p', String(Math.min(1, x / AT)));
  };
  /** @param {TouchEvent} e */
  function start(e) {
    mine = e.touches.length === 1 && fn && !(/** @type {HTMLElement} */ (e.target).closest('textarea, input')) ? null : false;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    d = 0;
    node.classList.remove('swipe-back');
  }
  /** @param {TouchEvent} e */
  function move(e) {
    if (mine === false) return;
    const dx = x0 - e.touches[0].clientX;
    const dy = e.touches[0].clientY - y0;
    if (mine === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      mine = dx > 0 && dx > Math.abs(dy) * 1.5;
      if (!mine) return;
    }
    e.preventDefault();
    const was = d;
    d = Math.max(0, Math.min(MAX, dx - 10));
    if (was < AT && d >= AT) navigator.vibrate?.(10);
    set(d);
  }
  function end() {
    if (!mine) return;
    mine = null;
    if (d >= AT) fn?.();
    node.classList.add('swipe-back'); // springs back
    set(0);
  }
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
  return {
    /** @param {(() => void) | undefined} next */
    update(next) {
      fn = next;
    },
    destroy() {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    },
  };
}

/**
 * @typedef {{ dirs: ('down' | 'right' | 'left')[], onclose: () => void }} SwipeOptions
 * @param {HTMLElement} node @param {SwipeOptions} opts
 */
export function swipeClose(node, opts) {
  let o = opts;
  let x0 = 0, y0 = 0, t0 = 0;
  /** @type {'down' | 'right' | 'left' | null | false} null — not decided yet, false — not ours */
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
      else if (o.dirs.includes('left') && dx < 0 && -dx > Math.abs(dy) * 1.5 && !sideScroller(e.target)) axis = 'left';
      else {
        axis = false;
        return;
      }
      node.style.transition = 'none';
    }
    d = Math.max(0, axis === 'down' ? dy : axis === 'left' ? -dx : dx);
    node.style.transform = axis === 'down' ? `translateY(${d}px)` : `translateX(${axis === 'left' ? -d : d}px)`;
    e.preventDefault();
  }
  function end() {
    if (!axis) return;
    const size = axis === 'down' ? node.offsetHeight : node.offsetWidth;
    const fast = d / Math.max(1, Date.now() - t0) > 0.6 && d > 30;
    node.style.transition = 'transform 0.18s ease';
    if (fast || d > Math.min(120, size / 3)) {
      node.style.transform = axis === 'down' ? 'translateY(100%)' : axis === 'left' ? 'translateX(-100%)' : 'translateX(100%)';
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
