// @ts-check
// A sidebar panel's filter header that folds down to its summary line (the count) by hand — the
// button next to the count; the state is remembered per browser. (It does not fold by itself while
// the list scrolls: moving the list under the finger was more trouble than help.)

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** @param {string} key  localStorage key for the folded state */
export function foldingHead(key) {
  const s = $state({ folded: read(key) });

  return {
    get folded() {
      return s.folded;
    },
    toggle() {
      s.folded = !s.folded;
      try {
        localStorage.setItem(key, s.folded ? '1' : '0');
      } catch {}
    },
  };
}
