// @ts-check
// A sidebar panel's filter header that folds down to its summary line (the count):
// by hand — the button next to the count, remembered per browser — or by itself while the list
// scrolls down (it comes back on scrolling up, unless folded by hand).

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** @param {Element} node */
function scroller(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** @param {string} key  localStorage key for the folded-by-hand state */
export function foldingHead(key) {
  const s = $state({ pinned: read(key), auto: false });
  let lastY = 0;
  let holdUntil = 0;
  // Folding changes the header's height and so the scroll position: those scroll events are not the reader's.
  const hold = () => (holdUntil = Date.now() + 350);

  return {
    get folded() {
      return s.pinned || s.auto;
    },
    toggle() {
      const fold = !(s.pinned || s.auto);
      s.pinned = fold;
      s.auto = false;
      hold();
      try {
        localStorage.setItem(key, fold ? '1' : '0');
      } catch {}
    },
    /** Action for an element inside the scrolling list. @param {HTMLElement} node */
    track(node) {
      const box = scroller(node);
      if (!box) return;
      lastY = box.scrollTop;
      const onScroll = () => {
        const y = box.scrollTop;
        const dy = y - lastY;
        lastY = y;
        if (s.pinned || Date.now() < holdUntil) return;
        const want = y < 8 ? false : dy > 6 ? true : dy < -10 ? false : s.auto;
        if (want !== s.auto) {
          s.auto = want;
          hold();
        }
      };
      box.addEventListener('scroll', onScroll, { passive: true });
      return { destroy: () => box.removeEventListener('scroll', onScroll) };
    },
  };
}
