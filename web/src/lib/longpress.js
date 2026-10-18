// @ts-check
// A long press on a button does another thing than its tap (the phone's bottom bar: «Книга» held — a
// bookmark on the paragraph read; «Слушать» held — a note to it). Held half a second without moving:
// a short vibration, the thing done, and the tap that would follow is swallowed (and the system's menu).

const HOLD = 500;

/** @param {HTMLElement} node @param {(() => void) | undefined} fn */
export function longPress(node, fn) {
  let f = fn;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let x0 = 0, y0 = 0, fired = false;
  const cancel = () => clearTimeout(timer);
  /** @param {PointerEvent} e */
  function down(e) {
    fired = false;
    if (!f || !e.isPrimary || e.button > 0) return;
    x0 = e.clientX;
    y0 = e.clientY;
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(20);
      f?.();
    }, HOLD);
  }
  /** @param {PointerEvent} e */
  function move(e) {
    if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) cancel();
  }
  /** @param {Event} e */
  function swallow(e) {
    if (!fired) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'click') fired = false;
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', swallow, true);
  node.addEventListener('contextmenu', swallow, true);
  return {
    /** @param {(() => void) | undefined} next */
    update(next) {
      f = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', swallow, true);
      node.removeEventListener('contextmenu', swallow, true);
    },
  };
}
