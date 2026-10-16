// @ts-check
// A short note at the bottom of the screen; with an action (`Вернуть` after a removal) it stays longer
// and its button does the action.

/** @typedef {{ label: string, run: () => void }} ToastAction */
/** @type {{ message: string, action: ToastAction | null }} */
export const toast = $state({ message: '', action: null });

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

/** @param {string} message @param {ToastAction} [action] */
export function showToast(message, action) {
  toast.message = message;
  toast.action = action ?? null;
  clearTimeout(timer);
  timer = setTimeout(hideToast, action ? 6000 : 2200);
}

export function hideToast() {
  clearTimeout(timer);
  toast.message = '';
  toast.action = null;
}

/** The toast's button: its action, and the toast goes. */
export function runToastAction() {
  const a = toast.action;
  hideToast();
  a?.run();
}
