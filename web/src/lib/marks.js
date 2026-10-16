// @ts-check
// An administrator's marks on messages — what became of a bug or an idea users sent: taken (blue),
// in work (orange), done (green). The colors are in app.css ([data-mark]).

/** @type {[import('./api.js').Mark, string][]} the mark and what it means */
export const MARKS = [
  ['take', 'Взято'],
  ['work', 'В работе'],
  ['done', 'Готово'],
];

/** @param {string | null | undefined} mark */
export const markTitle = (mark) => MARKS.find((m) => m[0] === mark)?.[1] ?? '';
