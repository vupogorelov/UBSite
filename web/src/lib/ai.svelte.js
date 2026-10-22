// @ts-check
// A reader's AI for «Я и Книга»'s answers in the Book's own words (server/bookwords.js): their own, connected by a
// sign-in in the browser (OpenRouter), and the application's shared answers left today.
import { request } from './api.js';
import { showToast } from './toast.svelte.js';

/**
 * @typedef {{ provider: string, title: string, since: string }} AiConnection
 * @typedef {{ own: AiConnection | null, shared: { left: number, of: number } | null }} AiState
 */

/** @type {{ state: AiState | null }} */
export const myAi = $state({ state: null });

export async function loadMyAi() {
  try {
    myAi.state = await request('GET', '/api/ai/me');
  } catch {
    // (without a network: as it was)
  }
}

/** To the service's sign-in page; it comes back to this page. */
export async function connectMyAi() {
  try {
    const { url } = await request('POST', '/api/ai/me/connect', { provider: 'openrouter', back: location.pathname + location.search });
    location.href = url;
  } catch (e) {
    showToast(/** @type {Error} */ (e).message);
  }
}

export async function disconnectMyAi() {
  try {
    myAi.state = await request('DELETE', '/api/ai/me');
  } catch (e) {
    showToast(/** @type {Error} */ (e).message);
  }
}

/** «Новая тема»: the Book's next answer begins a conversation anew (a line in «Я и Книга» marks it). */
export async function newTopic() {
  try {
    await request('POST', '/api/ai/me/new-topic');
  } catch (e) {
    showToast(/** @type {Error} */ (e).message);
  }
}

/** Back from a service's sign-in (?ai=connected, or why not): said, and the address cleaned. */
export function noticeAiReturn() {
  const how = new URLSearchParams(location.search).get('ai');
  if (!how) return;
  showToast(how === 'connected' ? 'Нейросеть подключена' : how);
  const url = new URL(location.href);
  url.searchParams.delete('ai');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}
