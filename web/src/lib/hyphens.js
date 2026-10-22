// @ts-check
// Whether this browser hyphenates a language of the book («Переносы слов»: CSS hyphens: auto — on Android's WebView
// by the system's own dictionaries, which a device may lack): a long word in a narrow box — hyphenated, it fits;
// not, it sticks out.

/** @param {'ru' | 'en'} lang @param {string} [text] */
export function hyphenates(lang, text) {
  const box = document.createElement('div');
  box.lang = lang;
  box.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;width:5em;font:16px/1.4 serif;-webkit-hyphens:auto;hyphens:auto;';
  box.textContent = text ?? (lang === 'ru' ? 'непреодолимыми достопримечательностями' : 'incomprehensibility characteristically');
  document.body.append(box);
  const ok = box.scrollWidth <= box.clientWidth + 1;
  box.remove();
  return ok;
}

/** (for a while: which of the Foreword's long words the device splits — they were seen unsplit on a phone) */
export const PROBE_WORDS = ['самонамеренное', 'самосодержащее', 'самопроизвольное', 'самоэмпирическое', 'божественно', 'отождествляемое', 'непреодолимыми'];
