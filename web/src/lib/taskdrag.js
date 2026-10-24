// @ts-check
// Dragging a task or a subtask (TasksPage), by a finger and by a mouse alike (pointer events — the browser's
// own drag and drop does not work on phones): a finger holds it (a long press, a short buzz), a mouse just
// moves it. A copy follows the pointer; the target under it says where it would go — a task's middle: into
// it (a subtask), near its top or bottom: before or after it, a kanban column: there. Released over a
// target — `ondrop`; Esc, a stroke the system broke off, or no target — nothing. Near the scrolling area's
// edge the list scrolls on.
//
// Targets: elements with `data-drop` — "task:<id>" (its zones), "col:<status>" (a kanban column, its end).

/** @typedef {{ kind: 'task', id: number } | { kind: 'sub', id: number, parent: number }} DragWhat */
/** @typedef {{ type: 'task', id: number, zone: 'before' | 'after' | 'into' } | { type: 'col', status: string }} DropAt */
/** @typedef {{ what: DragWhat, ondrop: (what: DragWhat, at: DropAt) => void, enabled?: boolean }} DragOptions */

const HOLD = 380; // ms a finger holds before it drags
const SLOP = 8; // px a finger may wander while holding (more — a scroll or a swipe)
const START = 6; // px a mouse moves before it drags
const EDGE = 60; // px from the scrolling area's edge where it scrolls on

/** A drag is on (a row's swipe stays out of it: lib/swipe.js). */
export const dragging = () => document.documentElement.dataset.dragging === '1';

/** The nearest ancestor that scrolls up and down (else the page). @param {HTMLElement} el */
function scrollerOf(el) {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
  }
  return /** @type {HTMLElement} */ (document.scrollingElement ?? document.documentElement);
}

/** The nearest ancestor that scrolls sideways (the kanban's columns on a phone), or null. @param {HTMLElement} el */
function sideScrollerOf(el) {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowX;
    if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth) return e;
  }
  return null;
}

/** @param {HTMLElement} node @param {DragOptions} opts */
export function taskDrag(node, opts) {
  let o = opts;
  /** @type {PointerEvent | null} */ let down = null;
  let timer = 0;
  let active = false;
  /** @type {HTMLElement | null} */ let ghost = null;
  /** @type {HTMLElement | null} */ let over = null;
  /** @type {DropAt | null} */ let at = null;
  let x0 = 0, y0 = 0, gx = 0, gy = 0, px = 0, py = 0;
  /** @type {HTMLElement} */ let area = document.documentElement;
  /** @type {HTMLElement | null} */ let side = null;
  let raf = 0;

  /** @param {PointerEvent} e */
  function onDown(e) {
    if (o.enabled === false || e.button !== 0 || !e.isPrimary) return;
    if (/** @type {HTMLElement} */ (e.target).closest('input, textarea, select, [contenteditable], .no-drag')) return;
    // (a subtask inside its task's card: the innermost takes the press)
    if (/** @type {any} */ (e).taskDragTaken) return;
    /** @type {any} */ (e).taskDragTaken = true;
    down = e;
    x0 = px = e.clientX;
    y0 = py = e.clientY;
    if (e.pointerType !== 'mouse') timer = window.setTimeout(begin, HOLD);
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', cancel);
  }
  /** @param {PointerEvent} e */
  function onMove(e) {
    if (!down || e.pointerId !== down.pointerId) return;
    px = e.clientX;
    py = e.clientY;
    const d = Math.hypot(px - x0, py - y0);
    if (!active) {
      if (down.pointerType === 'mouse') {
        if (d > START) begin();
      } else if (d > SLOP) stop(); // a scroll or a swipe, not a drag
      return;
    }
    follow();
  }
  function begin() {
    clearTimeout(timer);
    if (!down || dragging()) return;
    active = true;
    document.documentElement.dataset.dragging = '1';
    if (down.pointerType !== 'mouse') navigator.vibrate?.(15);
    const r = node.getBoundingClientRect();
    gx = r.left;
    gy = r.top;
    ghost = /** @type {HTMLElement} */ (node.cloneNode(true));
    ghost.removeAttribute('id');
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: '0', zIndex: '200', pointerEvents: 'none' });
    document.body.append(ghost);
    node.classList.add('drag-source');
    area = scrollerOf(node);
    side = sideScrollerOf(node);
    // (its columns snap: while dragging it scrolls freely — snapping would pull it back; it snaps again after)
    if (side) side.style.scrollSnapType = 'none';
    addEventListener('keydown', onKey);
    follow();
    raf = requestAnimationFrame(edgeScroll);
  }
  /** The copy at the pointer; the target under it lit, with its zone. */
  function follow() {
    if (!ghost) return;
    ghost.style.transform = `translate(${px - x0}px, ${py - y0}px) rotate(1.5deg)`;
    const el = /** @type {HTMLElement | null} */ (document.elementFromPoint(px, py)?.closest('[data-drop]') ?? null);
    /** @type {DropAt | null} */
    let next = null;
    if (el) {
      const [type, v] = (el.dataset.drop ?? '').split(':');
      if (type === 'col') next = { type: 'col', status: v };
      else if (type === 'task') {
        const id = Number(v);
        const r = el.getBoundingClientRect();
        const y = (py - r.top) / r.height;
        const zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into';
        const self = o.what.kind === 'task' && o.what.id === id;
        const own = o.what.kind === 'sub' && o.what.parent === id && zone === 'into';
        if (!self && !own) next = { type: 'task', id, zone };
      }
    }
    if (over && over !== el) over.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-col');
    over = next ? el : null;
    at = next;
    if (over && next) {
      over.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-col');
      over.classList.add(next.type === 'col' ? 'drop-col' : `drop-${next.zone}`);
    }
  }
  /** Near the scrolling area's edge it scrolls on — up and down, and sideways (the kanban's next column). */
  function edgeScroll() {
    if (!active) return;
    const r = area === document.documentElement ? { top: 0, bottom: innerHeight } : area.getBoundingClientRect();
    const v = py < r.top + EDGE ? -(r.top + EDGE - py) / 4 : py > r.bottom - EDGE ? (py - (r.bottom - EDGE)) / 4 : 0;
    let moved = false;
    if (v) (area.scrollTop += v), (moved = true);
    if (side) {
      const s = side.getBoundingClientRect();
      const left = Math.max(s.left, 0), right = Math.min(s.right, innerWidth);
      const h = px < left + EDGE ? -(left + EDGE - px) / 3 : px > right - EDGE ? (px - (right - EDGE)) / 3 : 0;
      if (h) (side.scrollLeft += h), (moved = true);
    }
    if (moved) follow();
    raf = requestAnimationFrame(edgeScroll);
  }
  /** @param {PointerEvent} e */
  function onUp(e) {
    if (!down || e.pointerId !== down.pointerId) return;
    const was = active, where = at;
    stop();
    if (!was) return;
    // (the click that ends a drag — a mouse's — is not a tap on what it was dropped over)
    addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', swallow, true), 0);
    if (where) o.ondrop(o.what, where);
  }
  /** @param {Event} e */
  const swallow = (e) => (e.stopPropagation(), e.preventDefault());
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.key === 'Escape') stop();
  }
  function cancel() {
    stop();
  }
  function stop() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    down = null;
    active = false;
    delete document.documentElement.dataset.dragging;
    ghost?.remove();
    ghost = null;
    over?.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-col');
    over = null;
    at = null;
    node.classList.remove('drag-source');
    if (side) side.style.scrollSnapType = '';
    side = null;
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', cancel);
    removeEventListener('keydown', onKey);
  }
  /** While dragging by a finger the page does not scroll under it (and no menu pops up on the long press). @param {TouchEvent} e */
  const holdTouch = (e) => active && e.cancelable && e.preventDefault();
  /** @param {Event} e */
  const noMenu = (e) => (down || active) && e.preventDefault();

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('touchmove', holdTouch, { passive: false });
  node.addEventListener('contextmenu', noMenu);
  return {
    /** @param {DragOptions} next */
    update(next) {
      o = next;
    },
    destroy() {
      stop();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('touchmove', holdTouch);
      node.removeEventListener('contextmenu', noMenu);
    },
  };
}
