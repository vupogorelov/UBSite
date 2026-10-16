// @ts-check
// Pulling on past the end of a scrolled area leads on: at its bottom — to what comes next, at its top —
// to what came before (the book: the next paper from its beginning, the previous one at its end).
// The finger (touch) or the wheel (a mouse, a touchpad) gathers a pull; `onprogress` follows it
// (0…1, 1 — enough), releasing the finger past it, or the wheel reaching it, calls `ongo`.

/**
 * @typedef {'next' | 'prev'} PullDir
 * @typedef {{ can: (dir: PullDir) => boolean, onprogress: (dir: PullDir | null, p: number) => void, ongo: (dir: PullDir) => void }} PullOptions
 * @param {HTMLElement} node @param {PullOptions} opts
 */
export function edgePull(node, opts) {
  let o = opts;
  /** Finger distance and wheel amount that make a pull. */
  const TOUCH = 110, WHEEL = 700;
  /** A pull by the wheel starts with a fresh turn: one after this pause at the edge (the scroll's own
   * run-on into it — a flung touchpad, a wheel spun on — comes without pauses and never counts). */
  const FRESH = 200;
  const atTop = () => node.scrollTop <= 1;
  const atBottom = () => node.scrollTop + node.clientHeight >= node.scrollHeight - 2;

  /** @type {PullDir | null} */
  let dir = null;
  let p = 0;
  /** @param {PullDir | null} d @param {number} v */
  const show = (d, v) => {
    const was = p;
    dir = d;
    p = d ? Math.max(0, v) : 0;
    if (was < 1 && p >= 1) navigator.vibrate?.(10);
    o.onprogress(dir, Math.min(1, p));
  };
  const go = () => {
    const d = dir;
    show(null, 0);
    quietUntil = Date.now() + 700; // the new page's first moments: the wheel neither pulls nor scrolls it
    if (d) o.ongo(d);
  };
  let quietUntil = 0;

  // ---- touch ----
  /** Where the finger was when the edge was reached (null — not at an edge in this stroke). */
  let y0 = /** @type {number | null} */ (null);
  let x0 = 0;
  /** @type {PullDir | null} */
  let edge = null;
  let off = false;
  /** @param {TouchEvent} e */
  function start(e) {
    off = e.touches.length !== 1 || Date.now() < quietUntil || !!(/** @type {HTMLElement} */ (e.target).closest('input, textarea, [contenteditable]'));
    y0 = null;
    edge = null;
    x0 = e.touches[0]?.clientX ?? 0;
  }
  /** @param {TouchEvent} e */
  function move(e) {
    if (off) return;
    if (e.touches.length !== 1 || getSelection()?.isCollapsed === false) {
      off = true;
      return show(null, 0);
    }
    const t = e.touches[0];
    if (y0 === null) {
      // the edge reached in this stroke: the pull counts from here
      const d = atBottom() && o.can('next') ? 'next' : atTop() && o.can('prev') ? 'prev' : null;
      if (!d) return;
      edge = d;
      y0 = t.clientY;
      x0 = t.clientX;
      return;
    }
    const dy = t.clientY - y0;
    const pull = edge === 'next' ? -dy : dy;
    if (pull <= 0) {
      // moved back into the text: the pull starts again at the edge's next touch
      if (dir) show(null, 0);
      if ((edge === 'next' && !atBottom()) || (edge === 'prev' && !atTop())) y0 = null;
      return;
    }
    if (Math.abs(t.clientX - x0) > pull * 1.2) return; // a sideways stroke (the panels' swipes)
    show(edge, (pull - 12) / TOUCH);
  }
  function end() {
    if (dir && p >= 1) go();
    else if (dir) show(null, 0);
    y0 = null;
  }

  // ---- wheel ----
  let amount = 0;
  /** The edge a fresh turn of the wheel pulls at (null — none yet). @type {PullDir | null} */
  let wheelEdge = null;
  let lastWheel = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idle;
  const letGo = () => {
    amount = 0;
    wheelEdge = null;
    if (dir) show(null, 0);
  };
  /** @param {WheelEvent} e */
  function wheel(e) {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // zoom, sideways
    const now = Date.now();
    const fresh = now - lastWheel >= FRESH;
    lastWheel = now;
    /** @type {PullDir | null} */
    const d = e.deltaY > 0 && atBottom() ? 'next' : e.deltaY < 0 && atTop() ? 'prev' : null;
    if (now < quietUntil) {
      e.preventDefault(); // the turn that led here does not scroll the new page on: it opens at its start (or end)
      return letGo();
    }
    if (!d || !o.can(d)) return letGo();
    if (wheelEdge !== d) {
      if (!fresh) return; // still the scroll that brought it here
      wheelEdge = d;
      amount = 0;
    }
    clearTimeout(idle);
    idle = setTimeout(letGo, 700); // a pause lets the pull go
    const step = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * node.clientHeight : e.deltaY;
    amount += Math.abs(step);
    show(d, amount / WHEEL);
    if (p >= 1) {
      clearTimeout(idle);
      amount = 0;
      wheelEdge = null;
      go();
    }
  }

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: true });
  node.addEventListener('touchend', end, { passive: true });
  node.addEventListener('touchcancel', end, { passive: true });
  node.addEventListener('wheel', wheel, { passive: false });
  return {
    /** @param {PullOptions} next */
    update(next) {
      o = next;
    },
    destroy() {
      clearTimeout(idle);
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
      node.removeEventListener('wheel', wheel);
    },
  };
}
