// @ts-check
// Text to the clipboard, wherever the page is. The Clipboard API (navigator.clipboard) is refused in the
// Android app's WebView (it gives the page no clipboard permission) — there the old way works: a hidden
// field's text selected and copied (document.execCommand), within the tap. In a browser: the API first,
// the old way if it is refused.
import { native } from './native.js';

/** The old way: a hidden field's text selected and copied. @param {string} text */
function viaField(text) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  const was = /** @type {HTMLElement | null} */ (document.activeElement);
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  field.remove();
  was?.focus?.({ preventScroll: true });
  return ok;
}

/** Copies the text; false — it could not be. @param {string} text @returns {Promise<boolean>} */
export async function writeText(text) {
  // (in the app: the old way at once — the API's refusal would come after the tap's moment)
  if (native && viaField(text)) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return viaField(text);
  }
}
