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
  import { settings } from '../lib/settings.svelte.js';
  import { search } from '../lib/search.svelte.js';
  import { NAV_POOL, parseNav } from '../lib/phonenav.js';
  import { native } from '../lib/native.js';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';

  /**
   * The phone's bottom navigation: Книга · the sections the person chose (lib/phonenav.js; by default
   * Поиск · Заметки · Слушать · Чат) · Ещё. "Ещё" opens a sheet with the rest: the other sections,
   * workspaces, then the app's own (settings… and «О приложении» last); the account at the top.
   * @type {{ bookRoute: boolean, onopen: (d: 'settings' | 'workspaces' | 'admin' | 'account') => void }}
   */
  let { bookRoute, onopen } = $props();

  /** @typedef {import('../lib/phonenav.js').NavId} NavId */
  const ABOUT = /** @type {import('../lib/sections.svelte.js').Section} */ (SECTIONS.find((s) => s.id === 'about'));
  /** @param {NavId} id */
  const info = (id) => /** @type {(typeof NAV_POOL)[number]} */ (NAV_POOL.find((s) => s.id === id));

  let more = $state(false);
  /** Android, but not inside the app itself: "Ещё" offers the app. */
  const androidBrowser = !native && /Android/i.test(navigator.userAgent);

  // Inside the app: "Переустановить приложение", with its version and the site's ("1.2 → 1.3").
  const canDownload = (native?.version() ?? 0) >= 2; // (1.0–1.2 cannot save a file: through the browser then)
  const installed = canDownload ? (native?.appVersion?.() ?? '') : '';
  let latest = $state('');
  $effect(() => {
    if (!more || !native) return;
    fetch('/app/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => (latest = typeof v?.name === 'string' ? v.name : ''))
      .catch(() => {});
  });
  const versionText = $derived(installed && latest && latest !== installed ? `${installed} → ${latest}` : installed || (latest && !canDownload ? `есть ${latest}` : ''));
  function reinstall() {
    if (canDownload) location.href = '/app/ubsite.apk';
    else showToast('Один раз — через Chrome: Ещё → Android приложение');
  }
  $effect(() => {
    if (more) return onBack(() => (more = false));
  });
  const NOTES_TABS = ['notes', 'tags', 'collections'];
  /** The sections in the bar, as the person arranged them (Настройки → Нижняя панель). */
  const bar = $derived(parseNav(settings.phoneNav));
  /** The rest of them live in the "Ещё" sheet. */
  const sheet = $derived(NAV_POOL.filter((s) => !bar.includes(s.id)));
  /** The open section (for the highlight). @type {NavId | 'book' | 'about' | 'support'} */
  const current = $derived(
    route.path.startsWith('/chat') ? 'chat'
    : route.path.startsWith('/tasks') ? 'tasks'
    : route.path.startsWith('/about') ? 'about'
    : route.path === '/support' ? 'support'
    : ui.sidebarOpen && ui.tab === 'translate' ? 'translate'
    : ui.sidebarOpen && ui.tab === 'search' ? 'search'
    : ui.sidebarOpen && NOTES_TABS.includes(ui.tab) ? 'notes'
    : 'book',
  );
  /** "Ещё" is lit while a section of its sheet is open. */
  const inSheet = $derived(current === 'about' || current === 'support' || sheet.some((s) => s.id === current));
  /** A section's counter (0 — none). @param {NavId} id */
  function badge(id) {
    if (id === 'chat') return notify.chatUnread;
    if (id === 'translate') return notify.queue;
    if (id === 'search') return search.query ? search.total : 0;
    return 0;
  }
  // (search results are counted on the search screen, not as news on "Ещё")
  const moreBadge = $derived(sheet.some((s) => s.id !== 'search' && badge(s.id) > 0) || (ABOUT.badge?.() ?? 0) > 0);

  /** Opens a sidebar tab over the book (coming back to the book first from other pages). @param {any} tab */
  function openTab(tab) {
    more = false;
    // from a page of its own: back to the book with the section open (not toggled: it was not on screen)
    if (!bookRoute) return void (navigate(lastPath(), { root: true }), setTab(tab));
    if (ui.sidebarOpen && ui.tab === tab) ui.sidebarOpen = false;
    else setTab(tab);
  }
  function book() {
    more = false;
    if (!bookRoute) {
      navigate(lastPath(), { root: true });
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
    if (!bookRoute) navigate(lastPath(), { root: true });
    if (!tts.open) openPlayer(); // (if open, it was only covered by a section screen)
  }
  function notes() {
    openTab(NOTES_TABS.includes(ui.tab) ? ui.tab : 'notes');
  }
  /** What a section's button does. @param {NavId} id */
  function go(id) {
    more = false;
    if (id === 'search') openTab('search');
    else if (id === 'notes') notes();
    else if (id === 'listen') listen();
    else if (id === 'chat') ((ui.sidebarOpen = false), navigate('/chat'));
    else if (id === 'translate') openTab('translate');
    else if (id === 'tasks') ((ui.sidebarOpen = false), navigate('/tasks'));
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
  {#each bar as id (id)}
    {@const sec = info(id)}
    {@const n = badge(id)}
    {#if id === 'listen'}
      <button class:active={tts.open} onclick={listen} aria-pressed={tts.open} aria-label={tts.open ? 'Слушать: закрыть плеер' : 'Слушать: читать вслух'}>
        <span class="bn-icon"><Icon name="headphones" size={24} />{#if tts.playing}<span class="bn-dot"></span>{/if}</span>
        <span>Слушать</span>
      </button>
    {:else}
      <button class:active={current === id} onclick={() => go(id)}>
        <span class="bn-icon"><Icon name={/** @type {any} */ (sec.icon)} size={24} />{#if n && id !== 'search'}<span class="bn-badge">{n > 99 ? '99+' : n}</span>{/if}</span>
        <span>{sec.label}</span>
      </button>
    {/if}
  {/each}
  <button class:active={inSheet || more} onclick={() => (more = !more)} aria-expanded={more} aria-haspopup="dialog">
    <span class="bn-icon"><Icon name="dots" size={24} />{#if moreBadge}<span class="bn-dot"></span>{/if}</span>
    <span>Ещё</span>
  </button>
</nav>

{#if more}
  <button class="sheet-scrim" aria-label="Закрыть" onclick={() => (more = false)}></button>
  <!-- the profile (→ account), supporting the project, then grouped lists: sections · workspace · app -->
  <div class="sheet more-sheet" role="dialog" aria-label="Ещё" use:swipeClose={{ dirs: ['down'], onclose: () => (more = false) }}>
    <div class="sheet-grip" aria-hidden="true"></div>
    <button class="more-profile" onclick={fromMore(() => onopen('account'))} aria-label="Аккаунт и пароль">
      <span class="avatar">{(session.user?.displayName ?? session.user?.username ?? '?').slice(0, 1).toUpperCase()}</span>
      <span class="more-profile-name"><b>{session.user?.displayName ?? session.user?.username}</b><span>@{session.user?.username} · аккаунт и пароль</span></span>
      <Icon name="chevron" size={18} />
    </button>
    <button class="more-support" onclick={fromMore(() => navigate('/support'))}>
      <span class="ui-tile"><Icon name="ruble" size={20} /></span>
      <span class="more-profile-name"><b>Поддержать проект</b><span>Помочь развитию платформы</span></span>
      <Icon name="chevron" size={18} />
    </button>

    {#if sheet.length}
    <div class="ui-label more-label">Разделы</div>
    <div class="more-group">
      {#each sheet as s (s.id)}
        {@const n = badge(s.id)}
        <button class="more-row" onclick={() => go(s.id)} class:on={s.id === 'listen' && tts.open}>
          <Icon name={/** @type {any} */ (s.icon)} size={20} /><span class="more-row-label">{s.id === 'listen' && tts.open ? 'Закрыть плеер' : s.label}</span>
          {#if n}<span class="tg-badge">{badgeText(n)}</span>{/if}<Icon name="chevron" size={16} />
        </button>
      {/each}
    </div>
    {/if}

    <div class="ui-label more-label">Пространство</div>
    <div class="more-group">
      {#if session.workspaces.length > 1}
        <UiSelect class="more-row" icon="users" label="Сейчас" title="Рабочее пространство" value={String(session.workspace?.id ?? '')}
          onchange={(x) => switchWorkspace(Number(x))}
          options={session.workspaces.map((w) => ({ value: String(w.id), label: w.kind === 'personal' ? 'Личное' : w.name, hint: w.kind === 'personal' ? 'Только ваши заметки' : 'Общее с участниками' }))} />
      {/if}
      <button class="more-row" onclick={fromMore(() => onopen('workspaces'))}><Icon name="layers" size={20} /><span class="more-row-label">Рабочие пространства</span><Icon name="chevron" size={16} /></button>
    </div>

    <div class="ui-label more-label">Приложение</div>
    <div class="more-group">
      <button class="more-row" onclick={fromMore(() => onopen('settings'))}><Icon name="settings" size={20} /><span class="more-row-label">Настройки</span><Icon name="chevron" size={16} /></button>
      {#if session.user?.isAdmin}<button class="more-row" onclick={fromMore(() => onopen('admin'))}><Icon name="lock" size={20} /><span class="more-row-label">Администрирование</span><Icon name="chevron" size={16} /></button>{/if}
      {#if native}
        <button class="more-row" onclick={fromMore(reinstall)}><Icon name="cloud-download" size={20} /><span class="more-row-label">Переустановить приложение</span>{#if versionText}<span class="more-row-value">{versionText}</span>{/if}</button>
      {/if}
      {#if androidBrowser}
        <!-- the Android app (android/): reading aloud goes on with the screen off -->
        <button class="more-row" onclick={fromMore(() => (location.href = '/app/ubsite.apk'))}><Icon name="plus" size={20} /><span class="more-row-label">Android приложение</span></button>
      {/if}
      {#if pwa.canInstall}
        <button class="more-row" onclick={fromMore(install)}><Icon name="plus" size={20} /><span class="more-row-label">Установить приложение</span></button>
      {:else if pwa.ios}
        <button class="more-row" onclick={fromMore(() => showToast('Safari: кнопка «Поделиться» → «На экран „Домой“»'))}><Icon name="plus" size={20} /><span class="more-row-label">Установить на iPhone</span></button>
      {/if}
      <button class="more-row" onclick={fromMore(() => navigate('/about'))}><Icon name="info" size={20} /><span class="more-row-label">{ABOUT.label}</span><Icon name="chevron" size={16} /></button>
    </div>
  </div>
{/if}
