<script>
  import { api } from '../lib/api.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { formatTime } from '../lib/notes.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /**
   * Settings → Интеграции → the English text (administrators): where it comes from, whether and how
   * often it is kept in step, "Синхронизировать сейчас", and the reports of the runs.
   */

  /** @type {import('../lib/api.js').SyncConfig | null} */ let config = $state(null);
  /** @type {import('../lib/api.js').SyncRun[]} */ let runs = $state([]);
  let busy = $state(false);
  /** @type {number | null} */ let openRun = $state(null);

  async function load() {
    try {
      const r = await api.integration();
      config = r.config;
      runs = r.runs;
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
  $effect(() => void load());

  /** @param {{ enabled?: boolean, intervalHours?: number, url?: string }} patch */
  async function save(patch) {
    try {
      config = await api.saveIntegration(patch);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
  async function runNow() {
    busy = true;
    try {
      const r = await api.runIntegration();
      showToast(r.status === 'error' ? `Ошибка: ${r.message}` : r.status === 'unchanged' ? 'Текст не менялся' : 'Синхронизировано');
      await load();
      openRun = runs[0]?.id ?? null;
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    } finally {
      busy = false;
    }
  }

  const INTERVALS = /** @type {const} */ ([[6, '6 ч'], [12, '12 ч'], [24, 'Сутки'], [48, '2 дня'], [168, 'Неделя']]);
  const STATUS = { ok: 'Обновлено', unchanged: 'Без изменений', error: 'Ошибка' };
  /** SQLite UTC "2026-10-11 19:02:37" or ISO → "11 окт., 22:02". @param {string | null} t */
  const when = (t) => (t ? formatTime(t.includes('T') ? t.replace('T', ' ').slice(0, 19) : t) : '—');
  /** @param {import('../lib/api.js').SyncRun} r */
  function line(r) {
    const s = r.summary;
    if (r.status === 'error') return s.message ?? 'ошибка';
    if (r.status === 'unchanged' && !s.paragraphs) return s.message ?? 'текст не менялся';
    const parts = [];
    if (s.textChanged) parts.push(`текст: ${s.textChanged}`);
    if (s.markupOnly) parts.push(`разметка: ${s.markupOnly}`);
    if (s.titles) parts.push(`заголовки: ${s.titles}`);
    return parts.join(' · ') || 'без изменений';
  }
</script>

{#if !config}
  <p class="ui-hint pad">Загрузка…</p>
{:else}
  <div class="integ">
    <!-- the source: what it is and which version we have -->
    <section class="ui-card integ-source">
      <span class="ui-tile"><Icon name="globe" size={20} /></span>
      <span class="ui-card-body">
        <b class="integ-title">{config.title}</b>
        <span class="ui-card-meta">{config.provider} · версия {config.version || '—'}</span>
        <span class="integ-about">Английский оригинал — издание Uversa Press (общественное достояние) с его исправлениями, курсивом
          и словами Иисуса. Приходят только изменения; русский текст и всё, что сделано людьми, не трогается.</span>
      </span>
    </section>

    <div class="set-section">Синхронизация</div>
    <div class="set-card">
      <label class="set-item set-switch">
        <span class="set-item-text"><b>По расписанию</b><span>Сервер сам проверяет источник и забирает изменения.</span></span>
        <input type="checkbox" class="ui-switch" checked={config.enabled} onchange={(e) => save({ enabled: e.currentTarget.checked })} />
      </label>
      <div class="set-item" class:inactive={!config.enabled}>
        <b class="set-item-label">Как часто</b>
        <div class="ui-chips set-chips" role="radiogroup" aria-label="Как часто">
          {#each INTERVALS as [h, label] (h)}
            <button class="ui-chip" class:on={config.intervalHours === h} role="radio" aria-checked={config.intervalHours === h}
              disabled={!config.enabled} onclick={() => save({ intervalHours: h })}>{label}</button>
          {/each}
        </div>
      </div>
      <label class="set-item">
        <b class="set-item-label">Адрес источника</b>
        <input class="ui-input integ-url" value={config.url} onchange={(e) => save({ url: e.currentTarget.value })} spellcheck="false" />
      </label>
    </div>
    <button class="ui-btn primary integ-now" onclick={runNow} disabled={busy || config.running}>
      <Icon name="reset" size={18} />{busy || config.running ? 'Синхронизация…' : 'Синхронизировать сейчас'}
    </button>
    <p class="ui-hint integ-last">Последняя проверка: {when(config.lastRun)}</p>

    <div class="set-section">Отчёты</div>
    {#if !runs.length}
      <p class="ui-hint integ-last">Синхронизаций ещё не было.</p>
    {:else}
      <ol class="set-card integ-runs">
        {#each runs as r (r.id)}
          {@const s = r.summary}
          {@const more = !!s.paragraphs}
          <li class="integ-run-item" data-status={r.status}>
            <button class="integ-run-row" onclick={() => more && (openRun = openRun === r.id ? null : r.id)} aria-expanded={more ? openRun === r.id : undefined} disabled={!more}>
              <span class="ui-tile integ-status"><Icon name={r.status === 'error' ? 'close' : r.status === 'ok' ? 'check' : 'minus'} size={16} /></span>
              <span class="integ-run-text">
                <b>{STATUS[r.status]}{#if r.versionTo && r.versionTo !== r.versionFrom}<span class="integ-ver">{' · '}версия {r.versionFrom || 0} → {r.versionTo}</span>{/if}</b>
                <span>{when(r.startedAt)} · {r.trigger === 'manual' ? 'вручную' : 'по расписанию'}</span>
                <span>{line(r)}</span>
              </span>
              {#if more}<span class="integ-chev" class:open={openRun === r.id}><Icon name="chevron" size={16} /></span>{/if}
            </button>
            {#if openRun === r.id && more}
              <div class="integ-detail">
                <!-- the numbers of the run, then the changed texts (a sample) -->
                <div class="integ-stats">
                  <span><b>{s.textChanged}</b>текст изменён</span>
                  <span><b>{s.markupOnly}</b>только разметка</span>
                  <span><b>{s.unchanged}</b>без изменений</span>
                  <span><b>{s.numbering}</b>другая нумерация</span>
                </div>
                <p class="ui-hint">
                  {s.paragraphs} {plural(s.paragraphs, 'абзац', 'абзаца', 'абзацев')} в ответе{s.full ? ' (весь текст)' : ''}{#if s.notOurs}; нет у нас — {s.notOurs}{/if}{#if s.removedThere}; удалено в источнике — {s.removedThere} (у нас оставлены){/if}.
                </p>
                {#each s.samples ?? [] as d (d.ref)}
                  <div class="integ-diff">
                    <a href="/{d.ref}" class="integ-ref">{d.ref}</a>
                    <div><del>{d.before}</del></div>
                    <div><ins>{d.after}</ins></div>
                  </div>
                {/each}
                {#if s.samples?.length && s.textChanged > s.samples.length}<p class="ui-hint">…и ещё {s.textChanged - s.samples.length}</p>{/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </div>
{/if}
