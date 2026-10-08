<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { applySettings, setSetting } from '../lib/settings.svelte.js';
  import { linkClick, route, navigate, lastPath, exitPrompt, onBack } from '../lib/router.svelte.js';
  import { notify, startPolling, refreshCounts } from '../lib/notify.svelte.js';
  import NotificationsMenu from './NotificationsMenu.svelte';
  import { search, runSearch, stepHit } from '../lib/search.svelte.js';
  import { ui, setTab, NARROW } from '../lib/ui.svelte.js';
  import { session, switchWorkspace } from '../lib/session.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import Icon from './Icon.svelte';
  import GotoBox from './GotoBox.svelte';
  import Toc from './Toc.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import TagsPanel from './TagsPanel.svelte';
  import TranslationPanel from './TranslationPanel.svelte';
  import CollectionsPanel from './CollectionsPanel.svelte';
  import CollectionReader from './CollectionReader.svelte';
  import TasksPage from './TasksPage.svelte';
  import ChatPage from './ChatPage.svelte';
  import { connectChat, chatUi } from '../lib/chat.svelte.js';
  import { pwa, install } from '../lib/pwa.svelte.js';
  import { device, chrome } from '../lib/mobile.svelte.js';
  import { view } from '../lib/router.svelte.js';
  import BottomNav from './BottomNav.svelte';
  import Ribbon from './Ribbon.svelte';
  import AudioPlayer from './AudioPlayer.svelte';
  import VoicePanel from './VoicePanel.svelte';
  import AboutPage from './AboutPage.svelte';
  import { tts } from '../lib/tts.svelte.js';
  import { SECTIONS } from '../lib/sections.svelte.js';
  import ReadingQuick from './ReadingQuick.svelte';
  import { showToast } from '../lib/toast.svelte.js';
  import Reader from './Reader.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import WorkspacesPanel from './WorkspacesPanel.svelte';
  import AdminPanel from './AdminPanel.svelte';
  import AccountPanel from './AccountPanel.svelte';

  /** @type {import('../lib/api.js').Toc | null} */
  let toc = $state(null);
  let tocError = $state('');
  /** @type {'none' | 'settings' | 'workspaces' | 'admin' | 'account'} */
  let drawer = $state('none');
  let menuOpen = $state(false);
  /** @type {GotoBox} */
  let gotoBox;
  /** @type {SearchPanel | undefined} */
  let searchPanel = $state();

  $effect(applySettings);

  onMount(() => {
    api.toc().then((t) => (toc = t), (err) => (tocError = err.message));
    const stopPolling = startPolling();
    const stopChat = connectChat();
    return () => (stopPolling(), stopChat());
  });
  // Counters are refreshed on navigation too.
  let seenPath = route.path;
  $effect(() => {
    if (route.path !== seenPath) {
      seenPath = route.path;
      void refreshCounts();
    }
  });

  const THEMES = /** @type {const} */ (['light', 'paper', 'dark', 'graphite']);
  function cycleTheme() {
    const current = THEMES.indexOf(/** @type {any} */ (document.documentElement.dataset.theme));
    setSetting('theme', THEMES[(current + 1) % THEMES.length]);
  }

  /** @param {string} q */
  function searchFromTopbar(q) {
    setTab('search');
    runSearch(q);
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault();
      gotoBox.focus();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      setTab('search');
      queueMicrotask(() => searchPanel?.focus());
    } else if (e.key === 'F3' && search.refs.length) {
      e.preventDefault();
      stepHit(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      drawer = 'none';
      menuOpen = false;
    }
  }

  // ---- Resizable sidebar: drag its edge; the width is remembered per browser ----
  const WIDTH_KEY = 'ub.sidebarWidth';
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 720;
  const DEFAULT_WIDTH = 360;
  let sidebarWidth = $state(readWidth());
  let resizing = $state(false);

  function readWidth() {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  }
  /** @param {number} w */
  function setWidth(w) {
    // Keep at least 400px for the text.
    sidebarWidth = Math.round(Math.min(Math.max(w, MIN_WIDTH), Math.min(MAX_WIDTH, innerWidth - 400)));
  }
  function saveWidth() {
    try {
      localStorage.setItem(WIDTH_KEY, String(sidebarWidth));
    } catch {}
  }
  /** @param {PointerEvent} e */
  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = /** @type {HTMLElement} */ (e.currentTarget);
    handle.setPointerCapture(e.pointerId);
    resizing = true;
    const move = (/** @type {PointerEvent} */ ev) => setWidth(ev.clientX);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      resizing = false;
      saveWidth();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }
  /** @param {KeyboardEvent} e */
  function resizeByKey(e) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') setWidth(sidebarWidth - step);
    else if (e.key === 'ArrowRight') setWidth(sidebarWidth + step);
    else if (e.key === 'Home') setWidth(DEFAULT_WIDTH);
    else return;
    e.preventDefault();
    saveWidth();
  }

  function closeSidebarIfNarrow() {
    if (innerWidth <= NARROW) ui.sidebarOpen = false;
  }

  /** @param {typeof drawer} d */
  function open(d) {
    menuOpen = false;
    drawer = d;
  }

  /** /c/12 — a collection in reading mode instead of the book. */
  const collectionId = $derived(/^\/c\/\d+\/?$/.test(route.path) ? Number(route.path.split('/')[2]) : null);

  /** /tasks — personal tasks in place of the book; the book's sidebar steps aside. */
  const tasksPage = $derived(route.path === '/tasks' || route.path.startsWith('/tasks?'));
  /** /chat — the chat page, also in place of the book. */
  const chatPage = $derived(route.path === '/chat' || route.path.startsWith('/chat?'));
  /** /about — the project's about.md. */
  const aboutPage = $derived(route.path === '/about');
  const fullPage = $derived(tasksPage || chatPage || aboutPage);

  // ---- Phone layout ----
  /** The book itself is on screen (not chat, tasks or a collection). */
  const bookRoute = $derived(!fullPage && collectionId === null);
  const reading = $derived(device.mobile && bookRoute);
  const chatOpen = $derived(chatPage && route.path.includes('c='));
  let quick = $state(false);
  /** The audio reader's panel is over the book (phone); a section screen covers it, reading goes on. */
  const listening = $derived(reading && tts.open && !ui.sidebarOpen);
  // The bars come back whenever a panel is opened.
  $effect(() => {
    if (ui.sidebarOpen || quick || drawer !== 'none') chrome.hidden = false;
  });
  // Phone: a section screen (contents, search, notes, the pronunciation dictionary…) closes on
  // "back" — back to the book (and to the player, if it was open).
  $effect(() => {
    if (device.mobile && ui.sidebarOpen) return onBack(() => void (ui.sidebarOpen = false));
  });
  /** "Где я": the paper on screen, as the phone header's title. */
  const here = $derived.by(() => {
    if (chatPage) return { kicker: '', title: 'Чат' };
    if (tasksPage) return { kicker: '', title: 'Мои задачи' };
    if (aboutPage) return { kicker: '', title: 'О приложении' };
    if (collectionId !== null) return { kicker: '', title: 'Подборка' };
    const p = toc?.papers.find((x) => x.id === view.paper);
    if (!p) return { kicker: '', title: 'Книга Урантии' };
    return { kicker: p.id === 0 ? 'Предисловие' : `Текст ${p.id}`, title: p.id === 0 ? 'Книга Урантии' : p.titleRu };
  });

  const initials = $derived((session.user?.displayName ?? session.user?.username ?? '?').slice(0, 1).toUpperCase());
  /** The desktop switches sidebar sections in the ribbon. On the phone the sidebar shows one section;
   *  the notes screen keeps its sections (notes, tags, collections) as chips. */
  const NOTES_TABS = SECTIONS.filter((s) => s.id === 'notes' || s.phone === 'notes');
  const shownTabs = $derived(
    device.mobile && NOTES_TABS.some((s) => s.tab === ui.tab)
      ? NOTES_TABS.map((s) => /** @type {[import('../lib/ui.svelte.js').Tab, string, string]} */ ([s.tab, s.label, s.icon]))
      : [],
  );
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" class:toc-open={ui.sidebarOpen && !fullPage} class:tasks-mode={fullPage} class:resizing style:--toc-width="{sidebarWidth}px"
  class:mobile={device.mobile} class:reading class:chrome-hidden={reading && chrome.hidden && !ui.sidebarOpen && !listening}
  class:in-conversation={device.mobile && chatOpen} class:listening>
  <header class="topbar">
    {#if device.mobile}
      <!-- Phone header: where I am (tap → contents), reading settings, notifications. -->
      <button class="m-here" onclick={() => (bookRoute ? (ui.sidebarOpen && ui.tab === 'toc' ? (ui.sidebarOpen = false) : setTab('toc')) : navigate(lastPath()))}
        aria-label="Оглавление">
        {#if here.kicker}<span class="m-here-kicker">{here.kicker}</span>{/if}
        <span class="m-here-title">{here.title}</span>
      </button>
      <span class="spacer"></span>
      {#if chatPage && !chatOpen}
        <!-- the chat list: search and a new channel open from here (the list stays clean) -->
        <button class="icon-btn" class:on={chatUi.search} onclick={() => (chatUi.search = !chatUi.search)} aria-label="Поиск по чатам" aria-expanded={chatUi.search}><Icon name="search" /></button>
        {#if session.user?.isCoordinator || session.user?.isAdmin}
          <button class="icon-btn" class:on={chatUi.creating} onclick={() => (chatUi.creating = !chatUi.creating)} aria-label="Новый канал"><Icon name="plus" /></button>
        {/if}
      {/if}
      {#if bookRoute}
        <button class="icon-btn m-aa" onclick={() => (quick = !quick)} aria-label="Настройки чтения" aria-expanded={quick}>Aa</button>
      {/if}
      <NotificationsMenu />
    {:else}
    <button class="icon-btn" onclick={() => (ui.sidebarOpen = !ui.sidebarOpen)} aria-label="Боковая панель" aria-expanded={ui.sidebarOpen}>
      <Icon name="menu" />
    </button>
    <a class="brand" href="/0" onclick={linkClick}>Urantian Docs Explorer</a>
    <GotoBox bind:this={gotoBox} onsearch={searchFromTopbar} />
    <div class="spacer"></div>
    {#if session.workspaces.length > 1}
      <select class="text-input ws-switch" aria-label="Рабочее пространство" value={session.workspace?.id}
        onchange={(e) => switchWorkspace(Number(e.currentTarget.value))}>
        {#each session.workspaces as w (w.id)}
          <option value={w.id}>{w.kind === 'personal' ? 'Личное' : w.name}</option>
        {/each}
      </select>
    {/if}
    <NotificationsMenu />
    <button class="icon-btn" onclick={cycleTheme} title="Сменить тему" aria-label="Сменить тему">
      <Icon name="theme" />
    </button>
    <button class="icon-btn" onclick={() => open('settings')} title="Настройки" aria-label="Настройки">
      <Icon name="settings" />
    </button>
    <div class="user-menu">
      <button class="avatar" onclick={() => (menuOpen = !menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen}
        title={session.user?.username}>{initials}</button>
      {#if menuOpen}
        <button class="menu-scrim" aria-label="Закрыть меню" onclick={() => (menuOpen = false)}></button>
        <div class="menu" role="menu">
          <div class="menu-head">{session.user?.displayName ?? session.user?.username}</div>
          <button role="menuitem" onclick={() => open('workspaces')}>Рабочие пространства</button>
          {#if session.user?.isAdmin}<button role="menuitem" onclick={() => open('admin')}>Администрирование</button>{/if}
          <button role="menuitem" onclick={() => open('account')}>Аккаунт и пароль</button>
          {#if pwa.canInstall}
            <button role="menuitem" onclick={() => ((menuOpen = false), install())}>Установить приложение</button>
          {:else if pwa.ios}
            <button role="menuitem" onclick={() => ((menuOpen = false), showToast('iPhone/iPad: кнопка «Поделиться» в Safari → «На экран „Домой“»'))}>
              Установить на iPhone…
            </button>
          {/if}
        </div>
      {/if}
    </div>
    {/if}
  </header>

  {#if !device.mobile}<Ribbon {bookRoute} />{/if}
  <div class="layout">
    <aside class="toc-pane" aria-hidden={!ui.sidebarOpen}>
      <div class="tabs" role="tablist" hidden={!shownTabs.length}>
        {#each shownTabs as [id, label, icon] (id)}
          <button role="tab" aria-selected={ui.tab === id} class:active={ui.tab === id} onclick={() => setTab(id)}
            title={id === 'translate' && notify.queue ? `${label} · ждут вашего голоса: ${notify.queue}` : label}
            aria-label={id === 'search' && search.query ? `${label}: ${search.total}` : id === 'translate' && notify.queue ? `${label}: ждут вашего голоса ${notify.queue}` : label}>
            <Icon name={icon} /><span class="tab-label">{label}</span>
            {#if id === 'search' && search.query}<span class="tab-count">{search.total > 999 ? '999+' : search.total}</span>{/if}
            {#if id === 'translate' && notify.queue}<span class="tab-count">{notify.queue > 99 ? '99+' : notify.queue}</span>{/if}
          </button>
        {/each}
      </div>
      <div class="tab-body" hidden={ui.tab !== 'toc'}>
        {#if toc}
          <Toc {toc} onnavigate={closeSidebarIfNarrow} />
        {:else}
          <p class="muted pad">{tocError || 'Загрузка…'}</p>
        {/if}
      </div>
      <div class="tab-body" hidden={ui.tab !== 'search'}>
        <SearchPanel bind:this={searchPanel} onnavigate={closeSidebarIfNarrow} />
      </div>
      <div class="tab-body" hidden={ui.tab !== 'notes'}>
        <NotesPanel visible={ui.tab === 'notes' && ui.sidebarOpen} onnavigate={closeSidebarIfNarrow} />
      </div>
      <div class="tab-body" hidden={ui.tab !== 'tags'}>
        <TagsPanel visible={ui.tab === 'tags' && ui.sidebarOpen} />
      </div>
      <div class="tab-body" hidden={ui.tab !== 'collections'}>
        <CollectionsPanel visible={ui.tab === 'collections' && ui.sidebarOpen} onnavigate={closeSidebarIfNarrow} />
      </div>
      <div class="tab-body" hidden={ui.tab !== 'translate'}>
        <TranslationPanel visible={ui.tab === 'translate' && ui.sidebarOpen} onnavigate={closeSidebarIfNarrow} />
      </div>
      <div class="tab-body" hidden={ui.tab !== 'voice'}>
        <VoicePanel visible={ui.tab === 'voice' && ui.sidebarOpen} />
      </div>
    </aside>
    {#if ui.sidebarOpen}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="pane-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина боковой панели"
        aria-valuenow={sidebarWidth} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} tabindex="0"
        title="Потяните, чтобы изменить ширину · двойной щелчок — исходная ширина"
        onpointerdown={startResize} ondblclick={() => (setWidth(DEFAULT_WIDTH), saveWidth())} onkeydown={resizeByKey}></div>
    {/if}
    <button class="toc-scrim" aria-label="Закрыть панель" onclick={() => (ui.sidebarOpen = false)}></button>
    <main class="reader-pane">
      {#if tasksPage}<TasksPage />{:else if chatPage}<ChatPage />{:else if aboutPage}<AboutPage />{:else if collectionId !== null}<CollectionReader id={collectionId} />{:else}<Reader />{/if}
    </main>
  </div>

  <SettingsPanel open={drawer === 'settings'} onclose={() => (drawer = 'none')} />
  {#if drawer === 'workspaces'}<WorkspacesPanel onclose={() => (drawer = 'none')} />{/if}
  {#if drawer === 'admin'}<AdminPanel onclose={() => (drawer = 'none')} />{/if}
  {#if drawer === 'account'}<AccountPanel onclose={() => (drawer = 'none')} />{/if}
  {#if device.mobile}
    <BottomNav {bookRoute} onopen={open} oncycletheme={cycleTheme} />
    {#if listening}<AudioPlayer />{/if}
    {#if quick}<ReadingQuick onclose={() => (quick = false)} onall={() => ((quick = false), open('settings'))} />{/if}
  {/if}
  {#if toast.message}<div class="toast" role="status">{toast.message}</div>{/if}
  {#if exitPrompt.shown}
    <!-- "Back" with nothing to close: the next one leaves the app. Any tap (here "Отмена") keeps it. -->
    <div class="exit-prompt" role="alertdialog" aria-live="assertive" aria-label="Выход из приложения">
      <span>Проведите «назад» ещё раз, чтобы выйти</span>
      <button class="btn" onclick={() => (exitPrompt.shown = false)}>Отмена</button>
    </div>
  {/if}
</div>
