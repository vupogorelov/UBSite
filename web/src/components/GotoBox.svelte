<script>
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/router.svelte.js';

  /** @type {{ onsearch: (q: string) => void }} */
  let { onsearch } = $props();

  let q = $state('');
  let error = $state('');
  /** @type {HTMLInputElement} */
  let input;

  export function focus() {
    input.focus();
    input.select();
  }

  // "5", "5:1", "5:1.3", "62.3", "(62.3)" are addresses; anything else is a search query.
  const ADDRESS = /^(?:\d+(?::\d+(?:\.\d+)?)?|\(?\d+\.\d+\)?)$/;

  /** @param {SubmitEvent} e */
  async function submit(e) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    if (!ADDRESS.test(text)) {
      q = '';
      input.blur();
      onsearch(text);
      return;
    }
    try {
      const { path } = await api.goto(text);
      q = '';
      error = '';
      input.blur();
      navigate(path);
    } catch (err) {
      error = /** @type {Error} */ (err).message;
    }
  }
</script>

<form class="goto" role="search" onsubmit={submit}>
  <input
    bind:this={input}
    bind:value={q}
    oninput={() => (error = '')}
    onkeydown={(e) => e.key === 'Escape' && input.blur()}
    placeholder="Найти или перейти: 5:1.3"
    aria-label="Поиск по тексту или переход к абзацу (5:1.3) или странице (62.3)"
  />
  <kbd>Ctrl K</kbd>
  {#if error}<div class="goto-error" role="alert">{error}</div>{/if}
</form>
