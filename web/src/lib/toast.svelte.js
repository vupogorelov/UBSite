// @ts-check
export const toast = $state({ message: '' });

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

/** @param {string} message */
export function showToast(message) {
  toast.message = message;
  clearTimeout(timer);
  timer = setTimeout(() => (toast.message = ''), 2200);
}
