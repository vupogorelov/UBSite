<script>
  import { ui, setTab } from '../lib/ui.svelte.js';
  import { route, navigate, lastPath, onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';
  import { notify } from '../lib/notify.svelte.js';
  import { session, switchWorkspace } from '../lib/session.svelte.js';
  import { pwa, install } from '../lib/pwa.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { SECTIONS, badgeText } from '../lib/sections.svelte.js';
  import { tts, openPlayer, stop } from '../lib/tts.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * The phone's bottom navigation: Книга · Поиск · Заметки · Чат · Ещё.
   * "Ещё" opens a sheet with the rest: the other sections (translation, tasks…), then settings,
   * workspaces, account.
   * @type {{ bookRoute: boolean, onopen: (d: 'settings' | 'workspaces' | 'admin' | 'account') => void, oncycletheme: () => void }}
   */
  let { bookRoute, onopen, oncycletheme } = $props();

  let more = $state(false);
  $effect(() => {
    if (more) return onBack(() => (more = false));
  });
  const NOTES_TABS = ['notes', 'tags', 'collections'];
  /** Sections without a place of their own on the phone live in "Ещё" (see lib/sections). */
  const MORE = SECTIONS.filter((s) => s.phone === 'more');
  /** The open section, for the highlight. */
  const current = $derived(
    route.path.startsWith('/chat') ? 'chat'
    : MORE.some((s) => (s.path ? route.path.startsWith(s.path) : ui.sidebarOpen && ui.tab === s.tab)) ? 'more'
    : ui.sidebarOpen && ui.tab === 'search' ? 'search'
    : ui.sidebarOpen && NOTES_TABS.includes(ui.tab) ? 'notes'
    : 'book',
  );
  const moreBadge = $derived(MORE.some((s) => (s.badge?.() ?? 0) > 0));

  /** Opens a sidebar tab over the book (coming back to the book first from other pages). @param {any} tab */
  function openTab(tab) {
    more = false;
    if (!bookRoute) navigate(lastPath());
    if (ui.sidebarOpen && ui.tab === tab) ui.sidebarOpen = false;
    else setTab(tab);
  }
  function book() {
    more = false;
    if (!bookRoute) {
      navigate(lastPath());
      ui.sidebarOpen = false;
    } else if (ui.sidebarOpen && ui.tab !== 'toc') ui.sidebarOpen = false;
    else if (ui.sidebarOpen) ui.sidebarOpen = false;
    else setTab('toc');
  }
  /** Reading aloud: opens the player over the book and starts from the text on screen; again — stops. */
  function listen() {
    more = false;
    if (tts.open && bookRoute && !ui.sidebarOpen) return stop();
    ui.sidebarOpen = false;
    if (!bookRoute) navigate(lastPath());
    if (!tts.open) openPlayer(); // (if open, it was only covered by a section screen)
  }
  function notes() {
    openTab(NOTES_TABS.includes(ui.tab) ? ui.tab : 'notes');
  }
  /** @param {() => void} fn */
  const fromMore = (fn) => () => {
    more = false;
    fn();
  };
</script>

<nav class="bottom-nav" aria-label="Разделы">
  <button class:active={current === 'book'} onclick={book} aria-label="Книга: чтение и оглавление">
    <Icon name="book-open" size={24} /><span>Книга</span>
  </button>
  <button class:active={current === 'search'} onclick={() => openTab('search')}>
    <Icon name="search" size={24} /><span>Поиск</span>
  </button>
  <button class:active={current === 'notes'} onclick={notes}>
    <Icon name="notes" size={24} /><span>Заметки</span>
  </button>
  <button class:active={tts.open} onclick={listen} aria-pressed={tts.open} aria-label={tts.open ? 'Слушать: закрыть плеер' : 'Слушать: читать вслух'}>
    <span class="bn-icon"><Icon name="headphones" size={24} />{#if tts.playing}<span class="bn-dot"></span>{/if}</span>
    <span>Слушать</span>
  </button>
  <button class:active={current === 'chat'} onclick={() => ((more = false), navigate('/chat'))}>
    <span class="bn-icon"><Icon name="discuss" size={24} />{#if notify.chatUnread}<span class="bn-badge">{notify.chatUnread > 99 ? '99+' : notify.chatUnread}</span>{/if}</span>
    <span>Чат</span>
  </button>
  <button class:active={current === 'more' || more} onclick={() => (more = !more)} aria-expanded={more} aria-haspopup="dialog">
    <span class="bn-icon"><Icon name="dots" size={24} />{#if moreBadge}<span class="bn-dot"></span>{/if}</span>
    <span>Ещё</span>
  </button>
</nav>

{#if more}
  <button class="sheet-scrim" aria-label="Закрыть" onclick={() => (more = false)}></button>
  <div class="sheet" role="dialog" aria-label="Ещё" use:swipeClose={{ dirs: ['down'], onclose: () => (more = false) }}>
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-user">
      <span class="avatar">{(session.user?.displayName ?? session.user?.username ?? '?').slice(0, 1).toUpperCase()}</span>
      <div><b>{session.user?.displayName ?? session.user?.username}</b><span class="muted small">@{session.user?.username}</span></div>
    </div>
    {#if session.workspaces.length > 1}
      <label class="sheet-ws">
        <span class="muted small">Рабочее пространство</span>
        <select class="text-input" value={session.workspace?.id} onchange={(e) => switchWorkspace(Number(e.currentTarget.value))}>
          {#each session.workspaces as w (w.id)}<option value={w.id}>{w.kind === 'personal' ? 'Личное' : w.name}</option>{/each}
        </select>
      </label>
    {/if}
    <div class="sheet-list">
      {#each MORE as s (s.id)}
        {@const n = s.badge?.() ?? 0}
        <button onclick={() => (s.path ? fromMore(() => navigate(s.path ?? '/'))() : s.tab && openTab(s.tab))}>
          <Icon name={/** @type {any} */ (s.icon)} />{s.label}{#if n}<span class="tg-badge">{badgeText(n)}</span>{/if}
        </button>
      {/each}
      <span class="sheet-sep" aria-hidden="true"></span>
      <button onclick={fromMore(() => onopen('settings'))}><Icon name="settings" />Настройки</button>
      <button onclick={fromMore(oncycletheme)}><Icon name="theme" />Сменить тему</button>
      <button onclick={fromMore(() => onopen('workspaces'))}><Icon name="layers" />Рабочие пространства</button>
      {#if session.user?.isAdmin}<button onclick={fromMore(() => onopen('admin'))}><Icon name="help" />Администрирование</button>{/if}
      <button onclick={fromMore(() => onopen('account'))}><Icon name="eye" />Аккаунт и пароль</button>
      {#if pwa.canInstall}
        <button onclick={fromMore(install)}><Icon name="plus" />Установить приложение</button>
      {:else if pwa.ios}
        <button onclick={fromMore(() => showToast('Safari: кнопка «Поделиться» → «На экран „Домой“»'))}><Icon name="plus" />Установить на iPhone</button>
      {/if}
    </div>
  </div>
{/if}
