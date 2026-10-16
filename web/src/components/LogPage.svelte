<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';

  /**
   * Администрирование → Журнал: what happened on people's devices (lib/log.js), to see a failure as it
   * was. Sessions (one opening of the app) newest first; one opens to its events in order — the screens,
   * the buttons, the server's failed or slow answers, the failures themselves.
   */

  /** @type {Awaited<ReturnType<typeof api.adminLog>>['people']} */
  let people = $state([]);
  /** @type {import('../lib/api.js').LogSession[]} */
  let sessions = $state([]);
  let who = $state('');
  let failedOnly = $state(false);
  let loading = $state(false);
  let more = $state(true);
  /** @type {string | null} */
  let open = $state(null);

  /** @param {boolean} [append] */
  async function load(append = false) {
    loading = true;
    try {
      const r = await api.adminLog({ user: who ? Number(who) : null, failed: failedOnly, before: append ? (sessions.at(-1)?.toAt ?? null) : null });
      people = r.people;
      sessions = append ? [...sessions, ...r.sessions] : r.sessions;
      more = r.sessions.length >= 20;
      if (!append) open = sessions.find((s) => s.errors)?.session ?? null; // (the latest failure opens by itself)
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    } finally {
      loading = false;
    }
  }
  onMount(() => void load());

  const KINDS = /** @type {Record<string, string>} */ ({
    app: 'Приложение', screen: 'Экран', tap: 'Нажатие', api: 'Сервер', error: 'Сбой', console: 'Сообщение', network: 'Сеть',
    tts: 'Озвучка', offline: 'Без сети', queue: 'Очередь', android: 'Android',
  });
  /** "15 окт., 14:05" from SQLite UTC. @param {string} at */
  const when = (at) => new Date(at.replace(' ', 'T') + 'Z').toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  /** "14:05:07" @param {string} at */
  const clock = (at) => new Date(at.replace(' ', 'T') + 'Z').toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  /** The event's details in a line. @param {unknown} data */
  function details(data) {
    if (data === null || data === undefined) return '';
    if (typeof data !== 'object') return String(data);
    return Object.entries(/** @type {Record<string, unknown>} */ (data))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ');
  }
</script>

<div class="log-page">
  <div class="log-filters">
    <UiSelect variant="inline" title="Кто" value={who} onchange={(x) => ((who = String(x)), load())}
      options={[{ value: '', label: 'Все' }, ...people.map((p) => ({ value: String(p.id), label: p.name, hint: p.errors ? `сбоев: ${p.errors}` : undefined }))]} />
    <button class="ui-chip" class:on={failedOnly} aria-pressed={failedOnly} onclick={() => ((failedOnly = !failedOnly), load())}>
      <Icon name="alert" size={14} />Только со сбоями</button>
  </div>

  {#if !sessions.length && !loading}
    <p class="ui-hint log-empty">{failedOnly ? 'Сбоев не было.' : 'Пока пусто: события приходят с устройств пачками, раз в минуту и сразу после сбоя.'}</p>
  {/if}

  <div class="log-sessions">
    {#each sessions as s (s.session)}
      <div class="log-session" class:failed={s.errors > 0}>
        <button class="log-head" onclick={() => (open = open === s.session ? null : s.session)} aria-expanded={open === s.session}>
          <span class="log-head-text">
            <b>{s.userName}</b>
            <span class="muted small ellipsis">{s.device}</span>
            <span class="muted small">{when(s.fromAt)} – {clock(s.toAt)} · {s.events.length} {plural(s.events.length, 'событие', 'события', 'событий')}</span>
          </span>
          {#if s.errors}<span class="log-badge">{s.errors} {plural(s.errors, 'сбой', 'сбоя', 'сбоев')}</span>{/if}
          <Icon name={open === s.session ? 'up' : 'down'} size={16} />
        </button>
        {#if open === s.session}
          <ol class="log-events">
            {#each s.events as e, i (i)}
              <li class="log-event" data-level={e.level}>
                <span class="log-time">{clock(e.at)}</span>
                <span class="log-kind">{KINDS[e.kind] ?? e.kind}</span>
                <span class="log-name">{e.name}{#if e.data}<span class="log-data">{details(e.data)}</span>{/if}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    {/each}
  </div>
  {#if more && sessions.length}
    <button class="ui-btn log-more" onclick={() => load(true)} disabled={loading}>Ещё</button>
  {/if}
</div>
