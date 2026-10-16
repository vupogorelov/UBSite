<script>
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';
  import SearchPanel from './SearchPanel.svelte';
  import Icon from './Icon.svelte';

  /**
   * Search from the left (a swipe to the right over the text, phone and tablet) — the mirror of the
   * book's notes on the right. The same search as the "Поиск" section; a result goes to its place and
   * the panel closes. The keyboard waits for a tap on the field.
   * @type {{ onclose: () => void }}
   */
  let { onclose } = $props();
  $effect(() => onBack(() => onclose()));
</script>

<button class="drawer-scrim book-notes-scrim" aria-label="Закрыть" onclick={onclose}></button>
<aside class="book-search side-panel" aria-label="Поиск" use:swipeClose={{ dirs: ['left'], onclose }}>
  <header class="side-head">
    <b>Поиск</b>
    <button class="ui-round plain" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
  </header>
  <div class="book-search-body">
    <SearchPanel onnavigate={onclose} history />
  </div>
</aside>
