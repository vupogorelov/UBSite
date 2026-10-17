<script>
  import { ui, setTab } from '../lib/ui.svelte.js';
  import { route, navigate, lastPath } from '../lib/router.svelte.js';
  import { SECTIONS, badgeText } from '../lib/sections.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import { tts, toggleDesktop } from '../lib/tts.svelte.js';

  /** ▶: reading aloud starts and the voice settings (with the pronunciation dictionary) open beside the
   *  book; ■: reading stops and they close. */
  function listen() {
    const starting = !tts.playing;
    toggleDesktop();
    if (starting) setTab('voice');
    else if (ui.tab === 'voice') ui.sidebarOpen = false;
  }
  import Icon from './Icon.svelte';

  /**
   * The desktop ribbon: a column of section icons at the left edge, as in Obsidian.
   * A sidebar section opens next to the book (a second click hides the sidebar); a page section
   * replaces the book (a second click goes back to the book).
   * @type {{ bookRoute: boolean }}
   */
  let { bookRoute } = $props();

  const GROUPS = /** @type {const} */ (['book', 'apps']);

  /** @param {import('../lib/sections.svelte.js').Section} s */
  const isActive = (s) => (s.path ? route.path.startsWith(s.path) : bookRoute && ui.sidebarOpen && ui.tab === s.tab);

  /** @param {import('../lib/sections.svelte.js').Section} s */
  function go(s) {
    if (s.path) {
      (isActive(s) ? navigate(lastPath(), { root: true }) : navigate(s.path));
    } else if (s.tab) {
      if (!bookRoute) navigate(lastPath(), { root: true });
      if (bookRoute && ui.sidebarOpen && ui.tab === s.tab) ui.sidebarOpen = false;
      else setTab(s.tab);
    }
  }
</script>

{#snippet item(/** @type {import('../lib/sections.svelte.js').Section} */ s)}
  {@const n = s.badge?.() ?? 0}
  <button class="ribbon-btn" class:active={isActive(s)} onclick={() => go(s)} aria-pressed={isActive(s)}
    title={n ? `${s.label}: ${n}` : s.label} aria-label={n ? `${s.label}: ${n}` : s.label}>
    <Icon name={/** @type {any} */ (s.icon)} size={18} />
    {#if n}<span class="tab-count">{badgeText(n)}</span>{/if}
  </button>
{/snippet}

<!-- Sections, then (after a line) the pages, reading aloud, and last — about the app. -->
<nav class="ribbon" aria-label="Разделы">
  {#each GROUPS as g, i (g)}
    {#if i}<span class="ribbon-sep" aria-hidden="true"></span>{/if}
    {#each SECTIONS.filter((s) => s.group === g && (!s.admin || session.user?.isAdmin)) as s (s.id)}{@render item(s)}{/each}
  {/each}
  <span class="ribbon-sep" aria-hidden="true"></span>
  <!-- Reading aloud (simplest form for now): from the first sentence on screen, with the voice settings; again — stop. -->
  <button class="ribbon-btn" class:active={tts.playing} onclick={listen} disabled={!bookRoute} aria-pressed={tts.playing}
    title={!bookRoute ? 'Слушать: откройте книгу' : tts.playing ? 'Остановить чтение' : 'Слушать: читать вслух с начала экрана'}
    aria-label={tts.playing ? 'Остановить чтение' : 'Слушать'}>
    <Icon name={tts.playing ? 'stop' : 'play'} size={18} />
  </button>
  <span class="ribbon-sep" aria-hidden="true"></span>
  {#each SECTIONS.filter((s) => s.group === 'meta') as s (s.id)}{@render item(s)}{/each}
</nav>
