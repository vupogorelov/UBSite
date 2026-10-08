// @ts-check
// Chrome may leave the blinking caret painted on screen when a focused field is removed from the
// page (e.g. a card's reply box disappearing when another card becomes active). The "ghost" then
// shows up wherever the layout puts something next. Blurring before removal makes Chrome erase it.

/**
 * Svelte action for inputs and textareas inside {#if} blocks: use:blurOnRemove
 * @param {HTMLElement} node
 */
export function blurOnRemove(node) {
  return {
    destroy() {
      const active = /** @type {HTMLElement | null} */ (document.activeElement);
      if (active && node.contains(active)) active.blur();
    },
  };
}
