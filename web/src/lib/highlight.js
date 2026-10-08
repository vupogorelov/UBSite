// @ts-check
// Text ranges inside rendered paragraphs. Offsets are in plain-text characters, which equal the
// element's textContent (the importer guarantees it), so we walk text nodes and count.
// Uses the CSS Custom Highlight API: no DOM changes, so search matches, colored highlights and
// the active note can overlap freely.

/**
 * @param {Element} el @param {number} start @param {number} end
 * @returns {Range | null}
 */
export function rangeFor(el, start, end) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = /** @type {Text} */ (node).length;
    if (!started && start <= pos + len) {
      range.setStart(node, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

/** Character offset of (node, offset) from the start of `el`. @param {Element} el @param {Node} node @param {number} offset */
export function textOffset(el, node, offset) {
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** The text element of one language in one paragraph. @param {ParentNode} root @param {string} ref @param {'ru' | 'en'} lang */
export function textElement(root, ref, lang) {
  return root.querySelector(`[data-ref="${ref}"][data-lang="${lang}"]`);
}

/** @param {ParentNode} root @param {string} ref @param {'ru' | 'en'} lang @param {number} start @param {number} end */
export function anchorRange(root, ref, lang, start, end) {
  const el = textElement(root, ref, lang);
  return el ? rangeFor(el, start, end) : null;
}

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

/** @param {string} name @param {Range[]} ranges @param {number} [priority] */
export function setRanges(name, ranges, priority = 0) {
  if (!supported) return;
  const h = new Highlight(...ranges);
  h.priority = priority;
  CSS.highlights.set(name, h);
}

/**
 * @param {string} name highlight name used in CSS as ::highlight(name)
 * @param {ParentNode} root container holding the paragraphs
 * @param {import('./api.js').Highlights} map
 * @param {number} [priority]
 */
export function setHighlights(name, root, map, priority = 0) {
  const ranges = [];
  for (const [ref, langs] of Object.entries(map)) {
    for (const lang of /** @type {const} */ (['ru', 'en'])) {
      for (const [s, e] of langs[lang]) {
        const r = anchorRange(root, ref, lang, s, e);
        if (r) ranges.push(r);
      }
    }
  }
  setRanges(name, ranges, priority);
}

/** @param {string} name */
export function clearHighlights(name) {
  if (supported) CSS.highlights.delete(name);
}
