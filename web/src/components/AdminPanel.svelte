<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { session } from '../lib/session.svelte.js';
  import { tr } from '../lib/translation.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { copyText, formatTime } from '../lib/notes.svelte.js';
  import { plural } from '../lib/format.js';
  import Drawer from './Drawer.svelte';
  import AnalyticsPage from './AnalyticsPage.svelte';
  import LogPage from './LogPage.svelte';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';

  /**
   * Administration in two levels, like the settings: sections of rows with a summary each
   * (users, registration and invitations, the voting rule) → the row's own page.
   * @type {{ onclose: () => void }}
   */
  let { onclose } = $props();

  /** The open page, or null for the list. @type {'users' | 'access' | 'voting' | 'analytics' | 'log' | null} */
  let page = $state(null);
  /** @type {Record<string, string>} */
  const PAGES = { users: 'Пользователи', access: 'Регистрация и приглашения', voting: 'Правило голосования', analytics: 'Аналитика', log: 'Журнал' };
  /** Analytics: a person's open card ("back" closes it first). @type {number | null} */
  let analyticsPerson = $state(null);
  /** Users: a user's own page ("back" closes it first). @type {number | null} */
  let userId = $state(null);
  /** @param {import('../lib/api.js').AdminUser} u */
  const nameOf = (u) => u.displayName || u.username;
  /** The roles of a user as short marks. @param {import('../lib/api.js').AdminUser} u */
  const roles = (u) => [u.isAdmin && 'админ', u.isCoordinator && 'координатор', u.isTranslator && 'переводчик'].filter(Boolean);
  /** What each role allows (a user's page). */
  const ROLES = /** @type {const} */ ([
    ['isTranslator', 'Переводчик', 'Публикует варианты перевода на голосование и голосует.'],
    ['isCoordinator', 'Координатор', 'Снимает варианты с голосования, отклоняет их, скрывает сообщения; ведёт глоссарий и словарь озвучки.'],
    ['isAdmin', 'Администратор', 'Всё вышеперечисленное, учётные записи, регистрация, правило голосования, аналитика.'],
  ]);

  /** @type {import('../lib/api.js').AdminUser[]} */
  let users = $state([]);
  const user = $derived(users.find((u) => u.id === userId) ?? null);
  let inviteAdmin = $state(false);
  /** @type {{ label: string, url: string } | null} */
  let link = $state(null);
  /** @type {import('../lib/api.js').VotingConfig | null} */
  let voting = $state(null);

  /** @type {boolean | null} */
  let registration = $state(null);

  const load = () => api.adminUsers().then((u) => (users = u), (err) => showToast(err.message));
  onMount(() => {
    load();
    api.registration().then((r) => (registration = r.open), (err) => showToast(err.message));
    api.adminVoting().then((v) => (voting = v), (err) => showToast(err.message));
  });

  // ---- Users: there may be many — search, filters with counts, an order, shown in portions ----
  const PORTION = 50;
  const WEEK = 7 * 86_400_000;
  /** @typedef {'all' | 'new' | 'admin' | 'translator' | 'coordinator' | 'disabled'} Filter */
  /** @type {[Filter, string][]} */
  const FILTERS = [['all', 'Все'], ['new', 'Новые за неделю'], ['admin', 'Админы'], ['translator', 'Переводчики'], ['coordinator', 'Координаторы'], ['disabled', 'Отключены']];
  let query = $state('');
  let filter = $state(/** @type {Filter} */ ('all'));
  let sort = $state(/** @type {'new' | 'name'} */ ('new'));
  let shown = $state(PORTION);

  /** @param {string} sqlTime */
  const ms = (sqlTime) => Date.parse(sqlTime.replace(' ', 'T') + 'Z');
  /** @type {Record<Filter, (u: import('../lib/api.js').AdminUser) => boolean>} */
  const TESTS = {
    all: () => true,
    new: (u) => Date.now() - ms(u.createdAt) < WEEK,
    admin: (u) => u.isAdmin,
    translator: (u) => u.isTranslator,
    coordinator: (u) => u.isCoordinator,
    disabled: (u) => u.disabled,
  };
  const counts = $derived(/** @type {Record<Filter, number>} */ (Object.fromEntries(FILTERS.map(([id]) => [id, users.filter(TESTS[id]).length]))));
  const found = $derived.by(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const list = users.filter((u) => TESTS[filter](u) && (!q || u.username.toLowerCase().includes(q) || (u.displayName ?? '').toLowerCase().includes(q)
      || (u.email ?? '').toLowerCase().includes(q)));
    return sort === 'new' ? list.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)) : list.sort((a, b) => a.username.localeCompare(b.username, 'ru'));
  });
  $effect(() => {
    void query, sort;
    shown = PORTION;
  });
  const usersSummary = $derived.by(() => {
    if (!users.length) return '…';
    const parts = [`${users.length} ${plural(users.length, 'пользователь', 'пользователя', 'пользователей')}`];
    if (counts.new) parts.push(`+${counts.new} за неделю`);
    parts.push(`админов ${counts.admin}`, `переводчиков ${counts.translator}`);
    if (counts.disabled) parts.push(`отключено ${counts.disabled}`);
    return parts.join(' · ');
  });

  /** @template T @param {() => Promise<T>} fn */
  async function act(fn) {
    try {
      return await fn();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
      return null;
    }
  }

  /** @param {boolean} open */
  async function setRegistration(open) {
    const r = await act(() => api.adminSetRegistration(open));
    registration = r ? r.open : !open;
    if (r) showToast(r.open ? 'Регистрация открыта' : 'Регистрация закрыта');
  }

  async function invite() {
    const r = await act(() => api.adminInvite(inviteAdmin));
    if (r) link = { label: `Приглашение${inviteAdmin ? ' администратора' : ''}`, url: r.url };
  }

  /** @param {import('../lib/api.js').AdminUser} u */
  async function reset(u) {
    const r = await act(() => api.adminReset(u.id));
    if (r) link = { label: `Новый пароль для ${u.username}`, url: r.url };
  }

  /** @param {import('../lib/api.js').AdminUser} u @param {{ disabled?: boolean, isAdmin?: boolean, isTranslator?: boolean, isCoordinator?: boolean }} patch */
  async function update(u, patch) {
    if ((await act(() => api.adminUpdate(u.id, patch))) === null) return;
    await load();
    // Own roles changed: refresh what the interface allows.
    if (u.id === session.user?.id) session.user = (await api.me()).user;
  }

  /** @param {SubmitEvent} e */
  async function saveVoting(e) {
    e.preventDefault();
    if (!voting) return;
    const v = await act(() => api.adminSetVoting(/** @type {import('../lib/api.js').VotingConfig} */ (voting)));
    if (v) {
      voting = v;
      tr.config = v;
      showToast('Правило голосования сохранено');
    }
  }

  /** @param {'users' | 'access' | 'voting' | 'analytics'} id */
  function openPage(id) {
    page = id;
    analyticsPerson = null;
    userId = null;
    link = null;
  }
  /** @param {number} id */
  function openUser(id) {
    userId = id;
    link = null;
  }
</script>

{#snippet row(/** @type {'users' | 'access' | 'voting' | 'analytics' | 'log'} */ id, /** @type {any} */ icon, /** @type {string} */ title, /** @type {string} */ sum)}
  <button class="set-row" onclick={() => openPage(id)}>
    <span class="set-row-icon"><Icon name={icon} size={18} /></span>
    <span class="set-row-text"><b>{title}</b><span class="muted small ellipsis">{sum}</span></span>
    <Icon name="chevron" size={16} />
  </button>
{/snippet}

{#snippet linkCard()}
  {#if link}
    <!-- a one-time link just made: an invitation or a new password -->
    <div class="ui-card adm-link">
      <b>{link.label}</b>
      <code>{link.url}</code>
      <button class="ui-chip" onclick={() => link && copyText(link.url)}><Icon name="copy" size={14} />Копировать</button>
      <span class="ui-hint">Одноразовая ссылка, действует 7 дней.</span>
    </div>
  {/if}
{/snippet}

<Drawer title={user ? nameOf(user) : page ? PAGES[page] : 'Администрирование'} subtitle={page ? undefined : 'Аналитика, учётные записи, роли'}
  {onclose} onback={page ? () => (analyticsPerson !== null ? (analyticsPerson = null) : userId !== null ? ((userId = null), (link = null)) : (page = null)) : null}>
  {#if page === null}
    <!-- the list: sections of rows with a summary each -->
    <div class="set-section">Аналитика</div>
    <div class="set-list">
      {@render row('analytics', 'list', 'Аналитика', 'Заходы, сессии, чтение и слушание, разделы, сообщения')}
      {@render row('log', 'alert', 'Журнал', 'Что происходило на устройствах — для разбора сбоев')}
    </div>
    <div class="set-section">Участники</div>
    <div class="set-list">
      {@render row('users', 'users', 'Пользователи', usersSummary)}
      {@render row('access', 'globe', 'Регистрация и приглашения',
        registration === null ? '…' : registration ? 'Регистрация открыта · ссылки-приглашения' : 'Регистрация закрыта · только приглашения')}
    </div>
    <div class="set-section">Перевод</div>
    <div class="set-list">
      {@render row('voting', 'translate', 'Правило голосования',
        voting ? `${Math.round(voting.threshold * 100)}% «за» · кворум ${voting.quorum} · ${voting.durationDays} ${plural(voting.durationDays, 'день', 'дня', 'дней')}` : '…')}
    </div>
  {/if}



  {#if page === 'analytics'}
    <AnalyticsPage bind:person={analyticsPerson} />
  {:else if page === 'log'}
    <LogPage />
  {:else if page === 'access'}
    <div class="set-section">Регистрация</div>
    <div class="set-card">
      <label class="set-item set-switch">
        <span class="set-item-text"><b>Открытая регистрация</b>
          <span>Каждый может сам создать учётную запись на странице входа и сразу работать как участник — с личным пространством.
            Не больше 3 регистраций с одного адреса в час. Выключите — останутся только приглашения.</span></span>
        <input type="checkbox" class="ui-switch" checked={registration ?? false} disabled={registration === null}
          onchange={(e) => setRegistration(e.currentTarget.checked)} />
      </label>
    </div>
    <div class="set-section">Приглашение по ссылке</div>
    <div class="set-card">
      <label class="set-item set-switch">
        <span class="set-item-text"><b>Как администратора</b><span>Новая учётная запись сразу получит права администратора.</span></span>
        <input type="checkbox" class="ui-switch" bind:checked={inviteAdmin} />
      </label>
    </div>
    <button class="ui-btn primary adm-main" onclick={invite}><Icon name="link" size={18} />Создать ссылку</button>
    {@render linkCard()}
    <p class="ui-hint adm-note">Человек сам выберет имя и пароль. В групповое пространство его можно добавить потом — или пригласить
      сразу туда из «Рабочих пространств».</p>
  {:else if page === 'users' && user}
    <!-- a user's own page: who, the roles (switches), access -->
    {@const u = user}
    {@const me = u.id === session.user?.id}
    <div class="ui-card adm-user-head" class:off={u.disabled}>
      <span class="an-avatar big">{nameOf(u).slice(0, 1).toUpperCase()}</span>
      <span class="ui-card-body">
        <b class="an-person-name">{nameOf(u)}{me ? ' (вы)' : ''}</b>
        <span class="ui-card-meta">@{u.username}{u.disabled ? ' · отключён' : ''}</span>
        {#if u.email}<span class="ui-card-meta">{u.email}{u.emailVerified ? ' · подтверждена' : ' · не подтверждена'}</span>{/if}
        <span class="ui-card-meta">с {formatTime(u.createdAt)}{u.hasPassword ? '' : ' · пароль не задан'}</span>
      </span>
    </div>
    <div class="set-section">Роли</div>
    <div class="set-card">
      {#each ROLES as [key, label, hint] (key)}
        {@const locked = key === 'isAdmin' && me}
        <label class="set-item set-switch" class:inactive={locked}>
          <span class="set-item-text"><b>{label}</b><span>{locked ? 'Свою роль администратора снять нельзя.' : hint}</span></span>
          <input type="checkbox" class="ui-switch" checked={u[key]} disabled={locked} onchange={(e) => update(u, { [key]: e.currentTarget.checked })} />
        </label>
      {/each}
    </div>
    <div class="set-section">Доступ</div>
    <div class="adm-actions">
      <button class="ui-btn" onclick={() => reset(u)}><Icon name="lock" size={18} />Ссылка для нового пароля</button>
      {#if !me}
        <button class="ui-btn" class:danger-text={!u.disabled} onclick={() => update(u, { disabled: !u.disabled })}>
          <Icon name={u.disabled ? 'check' : 'close'} size={18} />{u.disabled ? 'Включить учётную запись' : 'Отключить учётную запись'}
        </button>
      {/if}
    </div>
    {@render linkCard()}
    <p class="ui-hint adm-note">{u.disabled ? 'Отключённый не может войти; его заметки и сообщения остаются.' : 'Ссылка задаёт новый пароль; передайте её человеку лично. Отключённый не может войти, его заметки и сообщения остаются.'}</p>
  {:else if page === 'users'}
    <!-- many users: search, filters with counts, an order, shown in portions -->
    <label class="ui-search adm-search">
      <Icon name="search" size={18} />
      <input type="search" bind:value={query} placeholder="Имя, @логин или почта" aria-label="Поиск пользователей" />
      {#if query}<button class="ui-search-clear" onclick={(e) => (e.preventDefault(), (query = ''))} aria-label="Очистить"><Icon name="close" size={16} /></button>{/if}
    </label>
    <div class="ui-chips adm-filters" role="radiogroup" aria-label="Фильтр">
      {#each FILTERS as [id, label] (id)}
        <button class="ui-chip" class:on={filter === id} role="radio" aria-checked={filter === id}
          onclick={() => ((filter = id), (shown = PORTION))}>{label}<span class="adm-n">{counts[id]}</span></button>
      {/each}
    </div>
    <div class="adm-count">
      <span>Найдено: {found.length}</span>
      <UiSelect variant="inline" title="Порядок" value={sort} onchange={(x) => (sort = /** @type {any} */ (x))}
        options={[{ value: 'new', label: 'Сначала новые' }, { value: 'name', label: 'По имени' }]} />
    </div>
    {#if found.length}
      <div class="set-list">
        {#each found.slice(0, shown) as u (u.id)}
          <button class="set-row an-row" class:off={u.disabled} onclick={() => openUser(u.id)}>
            <span class="an-avatar">{nameOf(u).slice(0, 1).toUpperCase()}</span>
            <span class="set-row-text">
              <b class="ellipsis">{nameOf(u)}</b>
              <span class="muted small ellipsis">@{u.username}{u.disabled ? ' · отключён' : ''}{u.hasPassword ? '' : ' · без пароля'} · с {formatTime(u.createdAt)}</span>
              {#if roles(u).length}<span class="adm-roles">{#each roles(u) as r (r)}<span class="ui-chip small">{r}</span>{/each}</span>{/if}
            </span>
            <Icon name="chevron" size={16} />
          </button>
        {/each}
      </div>
    {:else}
      <p class="ui-hint adm-note">Никого не нашлось.</p>
    {/if}
    {#if found.length > shown}
      <button class="ui-btn adm-more" onclick={() => (shown += PORTION)}>Показать ещё · {found.length - shown}</button>
    {/if}
  {:else if page === 'voting' && voting}
    {@const v = voting}
    <form class="adm-voting" onsubmit={saveVoting}>
      <div class="set-card">
        <div class="set-item">
          <label class="set-item-label set-range-head" for="v-threshold"><b>Доля «за»</b><output>{Math.round(v.threshold * 100)}%</output></label>
          <input id="v-threshold" class="set-range" type="range" min="0.5" max="1" step="0.05" bind:value={v.threshold} />
          <span class="set-item-hint">Среди голосов «за» и «против»; воздержавшиеся не считаются.</span>
        </div>
        {#snippet stepper(/** @type {string} */ label, /** @type {string} */ hint, /** @type {'quorum' | 'durationDays'} */ key, /** @type {number} */ max, /** @type {(n: number) => string} */ unit)}
          <div class="set-item adm-step">
            <span class="set-item-text"><b>{label}</b><span>{hint}</span></span>
            <span class="adm-stepper">
              <button type="button" class="ui-round small" onclick={() => (v[key] = Math.max(1, v[key] - 1))} disabled={v[key] <= 1} aria-label="{label}: меньше"><Icon name="minus" size={16} /></button>
              <output aria-live="polite">{v[key]}<span>{unit(v[key])}</span></output>
              <button type="button" class="ui-round small" onclick={() => (v[key] = Math.min(max, v[key] + 1))} disabled={v[key] >= max} aria-label="{label}: больше"><Icon name="plus" size={16} /></button>
            </span>
          </div>
        {/snippet}
        {@render stepper('Кворум', 'Минимум голосов «за» и «против» вместе', 'quorum', 100, (n) => plural(n, 'голос', 'голоса', 'голосов'))}
        {@render stepper('Срок голосования', 'Сколько длится голосование', 'durationDays', 365, (n) => plural(n, 'день', 'дня', 'дней'))}
        <label class="set-item set-switch">
          <span class="set-item-text"><b>Принимать досрочно</b><span>Сразу, как только правило выполнено, не дожидаясь срока.</span></span>
          <input type="checkbox" class="ui-switch" bind:checked={v.decideEarly} />
        </label>
        <label class="set-item set-switch">
          <span class="set-item-text"><b>Автор голосует</b><span>Автор может голосовать за своё предложение.</span></span>
          <input type="checkbox" class="ui-switch" bind:checked={v.authorCanVote} />
        </label>
      </div>
      <button class="ui-btn primary adm-main" type="submit">Сохранить правило</button>
      <p class="ui-hint adm-note">По окончании срока: правило выполнено — принято; кворум есть, доли нет — отклонено;
        кворума нет — вариант возвращается автору в черновики. Новое правило применяется к текущим голосованиям
        при следующем голосе или по окончании срока.</p>
    </form>
  {/if}
</Drawer>
