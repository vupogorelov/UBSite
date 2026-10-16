<script>
  import { api } from '../lib/api.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /**
   * Администрирование → Аналитика: how people use the app over a period — the summary, the sections,
   * the people (sortable); a person → their card with every number. `person`: the open card (the
   * drawer's "back" closes it first).
   * @type {{ person: number | null }}
   */
  let { person = $bindable(null) } = $props();

  /** @typedef {import('../lib/api.js').AnalyticsPerson} Person */
  const PERIODS = /** @type {const} */ ([[7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [0, 'Всё время']]);
  const SECTIONS = /** @type {Record<string, string>} */ ({
    book: 'Книга', search: 'Поиск', notes: 'Заметки', collections: 'Подборки', tags: 'Теги', translate: 'Перевод',
    chat: 'Чат', tasks: 'Задачи', collection: 'Чтение подборки', about: 'О приложении', support: 'Поддержать', other: 'Другое',
  });
  /**
   * What the app is opened on: phones — blue, computers — orange; the Android app — the strongest, the site
   * installed — strong, a browser — light.
   * @type {[string, string, string][]}
   */
  const DEVICES = [
    ['phone-native', 'Телефон · приложение Android', '#1f5fae'],
    ['phone-app', 'Телефон · установленный сайт', '#4f8fdd'],
    ['phone-browser', 'Телефон · браузер', '#a3c6f0'],
    ['computer-app', 'Компьютер · установленный сайт', '#d27a2c'],
    ['computer-browser', 'Компьютер · браузер', '#efb77c'],
  ];
  /** The phones by their system. @type {[string, string, string][]} */
  const SYSTEMS = [
    ['android', 'Android', '#3f9a5b'],
    ['ios', 'iOS', '#6f7787'],
    ['other', 'Другая', '#c9c2b4'],
  ];
  /** The pie's slices and its CSS (a conic gradient). @param {Record<string, number>} d @param {[string, string, string][]} kinds */
  function pie(d, kinds) {
    const total = kinds.reduce((s, [k]) => s + (d[k] ?? 0), 0);
    if (!total) return null;
    let at = 0;
    const slices = kinds.map(([k, label, color]) => {
      const share = (d[k] ?? 0) / total;
      const from = at;
      at += share;
      return { k, label, color, share, from, to: at, minutes: d[k] ?? 0 };
    });
    const gradient = `conic-gradient(${slices.filter((s) => s.share).map((s) => `${s.color} ${s.from * 360}deg ${s.to * 360}deg`).join(', ')})`;
    return { slices, gradient };
  }
  const SORTS = /** @type {const} */ ([
    ['lastSeen', 'Заход'], ['sessions', 'Сессии'], ['reading', 'Чтение'], ['listening', 'Слушание'], ['messages', 'Сообщения'],
  ]);

  let days = $state(30);
  let report = $state(/** @type {import('../lib/api.js').AnalyticsReport | null} */ (null));
  /** @type {'lastSeen' | 'sessions' | 'reading' | 'listening' | 'messages'} */ let sort = $state('lastSeen');

  $effect(() => {
    const d = days;
    report = null;
    api.analytics(d).then((r) => d === days && (report = r), (err) => showToast(err.message));
  });

  // ---- By day: who came, how long they read and listened ----
  /** The day chosen on the charts (its numbers under them); null — the last day. */
  let dayAt = $state(/** @type {number | null} */ (null));
  $effect(() => {
    void days;
    dayAt = null;
  });
  const byDay = $derived(report?.daily ?? []);
  const chosenDay = $derived(byDay.length ? byDay[dayAt ?? byDay.length - 1] : null);
  const maxPeople = $derived(Math.max(1, ...byDay.map((d) => d.people)));
  const maxTime = $derived(Math.max(1, ...byDay.map((d) => d.reading + d.listening)));
  /** "13 окт." @param {string} day */
  const dayName = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  /** A round top for the scale: 4 → 4, 37 → 40, 130 → 150. @param {number} n */
  const nice = (n) => {
    const p = 10 ** Math.floor(Math.log10(n));
    return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((x) => x >= n) ?? n;
  };
  const people = $derived(
    (report?.people ?? []).toSorted((a, b) =>
      sort === 'lastSeen' ? (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') : b[sort] - a[sort] || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '')),
  );
  const open = $derived(report?.people.find((p) => p.id === person) ?? null);

  /** Minutes → "2 ч 15 мин", "45 мин", "—". @param {number} m */
  function dur(m) {
    const n = Math.round(m);
    if (!n) return '—';
    const h = Math.floor(n / 60);
    return h ? `${h} ч${n % 60 ? ` ${n % 60} мин` : ''}` : `${n} мин`;
  }
  /** "сегодня, 14:05", "вчера, 09:12", "6 окт." @param {string | null} iso */
  function seen(iso) {
    if (!iso) return 'не заходил';
    const d = new Date(iso);
    const day = new Date(d).setHours(0, 0, 0, 0);
    const today = new Date().setHours(0, 0, 0, 0);
    const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    if (day === today) return `сегодня, ${time}`;
    if (today - day === 86_400_000) return `вчера, ${time}`;
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  }
  /** @param {number} x */
  const num = (x) => (Math.round(x * 10) / 10).toLocaleString('ru');
  /** @param {string} name */
  const initial = (name) => name.trim().slice(0, 1).toUpperCase() || '?';
  /** Sections by time, with shares. @param {Record<string, number>} s */
  const shares = (s) => {
    const total = Object.values(s).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(s).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: SECTIONS[k] ?? k, minutes: v, share: v / total }));
  };
</script>

{#snippet bars(/** @type {Record<string, number>} */ s)}
  {#if Object.keys(s).length}
    <div class="an-bars">
      {#each shares(s) as b (b.name)}
        <div class="an-bar">
          <span class="an-bar-name">{b.name}</span>
          <span class="an-bar-track">{#if b.share >= 0.005}<span class="an-bar-fill" style:width="{Math.max(3, b.share * 100)}%"></span>{/if}</span>
          <span class="an-bar-value">{Math.round(b.share * 100)}%</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="ui-hint">Пока нет данных.</p>
  {/if}
{/snippet}

{#snippet devicePie(/** @type {Record<string, number>} */ d, /** @type {[string, string, string][]} */ kinds = DEVICES, /** @type {string} */ since = '13 октября')}
  {@const p = pie(d ?? {}, kinds)}
  {#if p}
    <div class="an-pie-card">
      <span class="an-pie" style:background={p.gradient} role="img"
        aria-label={p.slices.filter((s) => s.share).map((s) => `${s.label}: ${Math.round(s.share * 100)}%`).join(', ')}></span>
      <ul class="an-pie-legend">
        {#each p.slices as s (s.k)}
          <li class:zero={!s.share}><i style:background={s.color}></i><span>{s.label}</span><b>{Math.round(s.share * 100)}%</b></li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="ui-hint an-pie-empty">Данных пока нет: это записывается с {since} 2026 года.</p>
  {/if}
{/snippet}

{#snippet dayBars(/** @type {'people' | 'time'} */ kind)}
  {@const top = nice(kind === 'people' ? maxPeople : maxTime)}
  <div class="an-chart" role="img" aria-label={kind === 'people' ? 'Сколько человек заходило по дням' : 'Минуты чтения и слушания по дням'}>
    <span class="an-chart-top">{kind === 'people' ? top : dur(top)}</span>
    <div class="an-chart-bars" style:--n={byDay.length}>
      {#each byDay as d, i (d.day)}
        <button class="an-chart-col" class:on={i === (dayAt ?? byDay.length - 1)} onclick={() => (dayAt = i)}
          title="{dayName(d.day)}: {kind === 'people' ? `${d.people} ${plural(d.people, 'человек', 'человека', 'человек')}` : `читали ${dur(d.reading)}, слушали ${dur(d.listening)}`}"
          aria-label={dayName(d.day)}>
          {#if kind === 'people'}
            <span class="an-chart-bar" style:height="{(d.people / top) * 100}%"></span>
          {:else}
            <span class="an-chart-stack" style:height="{((d.reading + d.listening) / top) * 100}%">
              <span class="an-chart-bar listen" style:flex-grow={d.listening}></span>
              <span class="an-chart-bar" style:flex-grow={d.reading}></span>
            </span>
          {/if}
        </button>
      {/each}
    </div>
    <div class="an-chart-axis"><span>{dayName(byDay[0].day)}</span><span>{dayName(byDay[byDay.length - 1].day)}</span></div>
  </div>
{/snippet}

{#snippet stat(/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ hint = '')}
  <div class="an-stat"><span class="an-stat-value">{value}</span><span class="an-stat-label">{label}</span>{#if hint}<span class="an-stat-hint">{hint}</span>{/if}</div>
{/snippet}

<div class="an">
  <div class="ui-chips an-period" role="radiogroup" aria-label="Период">
    {#each PERIODS as [d, label] (d)}
      <button class="ui-chip" class:on={days === d} role="radio" aria-checked={days === d} onclick={() => (days = d)}>{label}</button>
    {/each}
  </div>

  {#if !report}
    <p class="ui-hint pad">Загрузка…</p>
  {:else if open}
    <!-- a person's card -->
    {@const p = open}
    <div class="ui-card an-person-head">
      <span class="an-avatar big">{initial(p.name)}</span>
      <span class="ui-card-body">
        <b class="an-person-name">{p.name}{#if p.disabled}<span class="an-off"> · отключён</span>{/if}</b>
        <span class="ui-card-meta">@{p.username} · последний заход: {seen(p.lastSeen)}</span>
      </span>
    </div>
    <div class="set-section">Сессии</div>
    <div class="an-grid">
      {@render stat('всего сессий', num(p.sessions))}
      {@render stat('последняя сессия', dur(p.lastSessionMinutes))}
      {@render stat('средняя', dur(p.average))}
      {@render stat('самая короткая', dur(p.shortest))}
      {@render stat('самая длинная', dur(p.longest))}
      {@render stat('всего в приложении', dur(p.sessionMinutes))}
    </div>
    <div class="set-section">В среднем сессий</div>
    <div class="an-list">
      {#each [['в неделю', p.perPeriod.week], ['в месяц', p.perPeriod.month], ['в квартал', p.perPeriod.quarter], ['в полугодие', p.perPeriod.half], ['в год', p.perPeriod.year]] as [label, v] (label)}
        <div class="an-list-row"><span>{label}</span><b>{num(/** @type {number} */ (v))}</b></div>
      {/each}
    </div>
    <div class="set-section">Книга</div>
    <div class="an-grid">
      {@render stat('читал всего', dur(p.reading))}
      {@render stat('читал за сессию', dur(p.readingPerSession), 'в среднем')}
      {@render stat('слушал всего', dur(p.listening))}
      {@render stat('слушал за сессию', dur(p.listeningPerSession), 'в среднем')}
    </div>
    <div class="set-section">Где бывает</div>
    {@render bars(p.sections)}
    <div class="set-section">Откуда открывает</div>
    {@render devicePie(p.devices)}
    <div class="set-section">Телефон: Android или iOS</div>
    {@render devicePie(p.phones, SYSTEMS, '16 октября')}
    <div class="set-section">Сделано</div>
    <div class="an-grid">
      {@render stat('сообщений', num(p.messages))}
      {@render stat('вопросов Книге', num(p.askedBook))}
      {@render stat('задач создано', num(p.tasks))}
      {@render stat('техподдержка', `${p.supportTaken} / ${p.supportDone}`, 'принято / реализовано')}
    </div>
  {:else}
    {@const t = report.totals}
    <!-- the summary -->
    <div class="an-grid">
      {@render stat('активных людей', `${t.activePeople} из ${t.people}`)}
      {@render stat('сессий', num(t.sessions))}
      {@render stat('средняя сессия', dur(t.average))}
      {@render stat('короткая / длинная', `${dur(t.shortest)} / ${dur(t.longest)}`)}
      {@render stat('читали', dur(t.reading), `за сессию ${dur(t.readingPerSession)}`)}
      {@render stat('слушали', dur(t.listening), `за сессию ${dur(t.listeningPerSession)}`)}
      {@render stat('сообщений', num(t.messages), `и ${t.askedBook} ${plural(t.askedBook, 'вопрос', 'вопроса', 'вопросов')} Книге`)}
      {@render stat('задач создано', num(t.tasks))}
      {@render stat('техподдержка', `${t.supportTaken} / ${t.supportDone}`, 'принято / реализовано')}
      {@render stat('последний заход', seen(t.lastSeen))}
    </div>
    {#if chosenDay && byDay.some((d) => d.people)}
      <!-- by day: two charts over the same days; a tap on a day shows its numbers -->
      <div class="set-section">По дням</div>
      <div class="an-days">
        <div class="an-days-head"><b>Заходили</b><span>человек в день</span></div>
        {@render dayBars('people')}
        <div class="an-days-head"><b>Чтение и слушание</b>
          <span class="an-key"><i></i>читали</span><span class="an-key listen"><i></i>слушали</span></div>
        {@render dayBars('time')}
        <p class="an-day-note">
          <b>{dayName(chosenDay.day)}</b> · {chosenDay.people} {plural(chosenDay.people, 'человек', 'человека', 'человек')}
          · читали {dur(chosenDay.reading)} · слушали {dur(chosenDay.listening)}
        </p>
      </div>
    {/if}
    <div class="set-section">Где бывают</div>
    {@render bars(t.sections)}
    <div class="set-section">Откуда открывают</div>
    {@render devicePie(t.devices)}
    <div class="set-section">Телефоны: Android или iOS</div>
    {@render devicePie(t.phones, SYSTEMS, '16 октября')}

    <div class="set-section">Люди · {people.length}</div>
    <div class="ui-chips an-sort" role="radiogroup" aria-label="Порядок">
      {#each SORTS as [k, label] (k)}
        <button class="ui-chip" class:on={sort === k} role="radio" aria-checked={sort === k} onclick={() => (sort = k)}>{label}</button>
      {/each}
    </div>
    <div class="set-list">
      {#each people as p (p.id)}
        <button class="set-row an-row" class:off={p.disabled} onclick={() => (person = p.id)}>
          <span class="an-avatar">{initial(p.name)}</span>
          <span class="set-row-text">
            <b class="ellipsis">{p.name}{#if p.disabled}<span class="muted"> · отключён</span>{/if}</b>
            <span class="muted small ellipsis">
              {[seen(p.lastSeen), p.sessions ? `${p.sessions} ${plural(p.sessions, 'сессия', 'сессии', 'сессий')}` : '', p.reading ? `читал ${dur(p.reading)}` : '', p.listening ? `слушал ${dur(p.listening)}` : '', p.messages ? `${p.messages} ${plural(p.messages, 'сообщение', 'сообщения', 'сообщений')}` : ''].filter(Boolean).join(' · ')}
            </span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      {/each}
    </div>
    <p class="ui-hint an-note">Время учитывается с 12 октября 2026 года: минута считается, когда приложение открыто и человек что-то делает
      (касание, прокрутка, клавиша за последние 2 минуты) или звучит озвучка. Сессия заканчивается после 30 минут без действий.</p>
  {/if}
</div>
