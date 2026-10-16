// @ts-check
// Moves an element to the end of <body>: a full-screen layer (a side panel over the book) then stands
// above the app's bars by its own z-index, instead of lifting the book's whole layer over them.

/** On a phone only (there the layer is a sheet over the whole screen; on a computer it stays in place). @param {HTMLElement} node */
export function phonePortal(node) {
  if (!matchMedia('(max-width: 767px)').matches) return;
  return portal(node);
}

/** @param {HTMLElement} node */
export function portal(node) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
