// @ts-check
// The voice as people choose it: one list — the narrator (a recording, where the language has one) and
// the device's voices; the speed and the tone. Over the player's settings (lib/tts.svelte.js).
import { tts, setVoice, voicesFor } from './tts.svelte.js';
import { native } from './native.js';

/** The narrator's value in the list of voices. */
export const NARRATOR = 'narrator';
/** Who reads the recording of each language. */
export const NARRATORS = /** @type {Record<string, string>} */ ({ ru: 'Григорий Войнер', en: 'Merritt Horn' });
/** The current language's voice as the list shows it: the narrator, or a synthesized voice ('' — the system's). */
export const voiceChoice = () => (tts[tts.lang].source === 'audio' && tts.recorded.includes(tts.lang) ? NARRATOR : tts[tts.lang].voice);
/** The list of voices: the narrator first (where the language has a recording), then the synthesized ones. */
export function voiceOptions() {
  /** @type {{ value: string, label: string, hint?: string, group?: string }[]} */
  const out = [];
  if (tts.recorded.includes(tts.lang)) out.push({ value: NARRATOR, label: NARRATORS[tts.lang], hint: 'Живой голос диктора' }); // (first, without a label: the synthesized ones follow under theirs)
  out.push({ value: '', label: 'Системный', hint: native ? 'Движок и голос из настроек Android' : 'Голос по умолчанию на этом устройстве', group: 'Синтез речи' });
  // (in the Android app the voices of each engine go under its name: Google, Huawei…)
  for (const x of voicesFor(tts.lang)) {
    const group = x.engine ? `Синтез речи · ${x.engine}` : 'Синтез речи';
    out.push({ value: x.id, label: x.name, hint: x.online ? 'онлайн-голос' : x.engine ? 'на устройстве' : undefined, group });
  }
  return out;
}
/** A voice chosen from the list. @param {string} x */
export function chooseVoice(x) {
  if (x === NARRATOR) return setVoice('source', 'audio');
  if (tts[tts.lang].source === 'audio') setVoice('source', 'tts');
  setVoice('voice', x);
}
/** The speed of what is heard (the narrator and the synthesized voice keep their own). */
const rateKey = () => (tts[tts.lang].source === 'audio' && tts.recorded.includes(tts.lang) ? 'audioRate' : 'rate');
export const currentRate = () => tts[tts.lang][rateKey()];
/** One button: +0.2 each tap, from 0.6 to 2.0, then round again. */
export function nextRate() {
  const r = currentRate();
  let n = (Math.floor(r / 0.2 + 1e-6) + 1) * 0.2;
  if (n > 2.0 + 1e-6) n = 0.6;
  setVoice(rateKey(), Math.round(n * 100) / 100);
}
/** The synthesized voice's tone: − / + by 0.1, from 0.5 to 2.0. @param {1 | -1} dir */
export function stepPitch(dir) {
  const p = Math.min(2, Math.max(0.5, tts[tts.lang].pitch + dir * 0.1));
  setVoice('pitch', Math.round(p * 10) / 10);
}
