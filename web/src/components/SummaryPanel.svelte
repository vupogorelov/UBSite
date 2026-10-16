<script>
  import { api } from '../lib/api.js';
  import { tr } from '../lib/translation.svelte.js';
  import { view } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';
  import UiSelect from './UiSelect.svelte';

  /** @type {{ visible: boolean }} */
  let { visible } = $props();

  let stats = $state(/** @type {import('../lib/api.js').TranslationStats | null} */ (null));
  let toc = $state(/** @type {import('../lib/api.js').Toc | null} */ (null));
  let error = $state('');
  let loaded = -1;

  $effect(() => {
    const v = tr.version;
    if (!visible || v === loaded) return;
    loaded = v;
    api.stats().then((s) => ((stats = s), (error = '')), (err) => (error = err.message));
    if (!toc) api.toc().then((t) => (toc = t), () => {});
  });

  // ---- Export ----
  let scope = $state(view.paper !== null ? `paper:${view.paper}` : 'all');
  let lang = $state(/** @type {'ru' | 'ruen'} */ ('ru'));
  let withChanges = $state(true);
  const ROMAN = ['', 'I', 'II', 'III', 'IV'];

  const href = $derived(`/api/export?scope=${encodeURIComponent(scope)}&lang=${lang}&format=md&changes=${withChanges ? 1 : 0}`);
  const csvHref = $derived(`/api/export?scope=${encodeURIComponent(scope)}&format=csv`);

  const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? Math.max(a ? 1 : 0, Math.round((a / b) * 100)) : 0);
  const changedTotal = $derived(stats ? stats.byPaper.reduce((s, p) => s + p.changedParagraphs, 0) : 0);
  /** What the export takes: the whole book, a part, a paper. */
  const scopes = $derived([
    { value: 'all', label: 'Вся книга' },
    ...(/** @type {any} */ (toc)?.parts ?? []).map((/** @type {any} */ p) => ({ value: `part:${p.id}`, label: `Часть ${ROMAN[p.id] ?? p.id}. ${p.titleRu}` })),
    ...(/** @type {any} */ (toc)?.papers ?? []).map((/** @type {any} */ p) => ({ value: `paper:${p.id}`, label: p.id === 0 ? 'Предисловие' : `Текст ${p.id}. ${p.titleRu}` })),
  ]);
</script>

<div class="ui-label">Экспорт новой редакции</div>
<section class="ui-card export-card">
  <UiSelect class="export-row" label="Объём" title="Что выгрузить" value={scope} onchange={(x) => (scope = x)} options={scopes} />
  <div class="export-lang">
    <span>Язык</span>
    <div class="ui-chips" role="radiogroup" aria-label="Язык">
      <button class="ui-chip" class:on={lang === 'ru'} role="radio" aria-checked={lang === 'ru'} onclick={() => (lang = 'ru')}>Русский</button>
      <button class="ui-chip" class:on={lang === 'ruen'} role="radio" aria-checked={lang === 'ruen'} onclick={() => (lang = 'ruen')}>Русский + английский</button>
    </div>
  </div>
  <label class="ui-option ui-switch-row export-switch">
    <span><b>Приложить список изменений</b><span class="muted small">В конце файла: абзац, было, стало</span></span>
    <input type="checkbox" class="ui-switch" bind:checked={withChanges} />
  </label>
  <p class="ui-hint">Markdown: принятые варианты стоят на месте исходных, курсив сохраняется.</p>
  <div class="export-actions">
    <a class="ui-btn" href={csvHref} download title="Таблица для Excel: абзац, было, стало, автор, дата, голоса">Изменения (CSV)</a>
    <a class="ui-btn primary" href={href} download>Скачать Markdown</a>
  </div>
</section>

{#if error}<div class="search-error">{error}</div>{/if}
{#if stats}
  <section class="stats">
    <div class="ui-label">Ход работы</div>
    <div class="stat-cards">
      <div class="stat-card"><b>{stats.totals.approved}</b><span>принято</span></div>
      <div class="stat-card"><b>{stats.totals.voting}</b><span>на голосовании</span></div>
      <div class="stat-card"><b>{stats.totals.draft}</b><span>в черновиках</span></div>
      <div class="stat-card"><b>{stats.totals.rejected}</b><span>отклонено</span></div>
    </div>
    <p class="ui-hint">
      Изменено {changedTotal} {plural(changedTotal, 'абзац', 'абзаца', 'абзацев')} из {stats.paragraphs.toLocaleString('ru')}
      ({pct(changedTotal, stats.paragraphs)}%).
    </p>

    {#if stats.byPaper.length}
      <div class="ui-label">По Текстам</div>
      <ol class="stat-papers ui-card">
        {#each stats.byPaper as p (p.id)}
          <li>
            <div class="stat-paper-head">
              <span class="ellipsis">{p.id === 0 ? 'Предисловие' : `${p.id}. ${p.title}`}</span>
              <span class="muted small">{p.approved} принято{p.voting ? ` · ${p.voting} на голос.` : ''}</span>
            </div>
            <div class="stat-bar" title="Изменено абзацев: {p.changedParagraphs} из {p.paragraphs}">
              <span style:width="{pct(p.changedParagraphs, p.paragraphs)}%"></span>
            </div>
          </li>
        {/each}
      </ol>
    {/if}

    {#if stats.people.length}
      <div class="ui-label">Участники</div>
      <div class="ui-card stat-people-card"><table class="stat-people">
        <thead><tr><th></th><th title="Опубликовано на голосование">Предл.</th><th>Принято</th><th>Голоса</th><th title="Сообщения в обсуждениях">Сообщ.</th></tr></thead>
        <tbody>
          {#each stats.people as u (u.id)}
            <tr><td class="ellipsis">{u.name}</td><td>{u.proposed}</td><td>{u.approved}</td><td>{u.votes}</td><td>{u.messages}</td></tr>
          {/each}
        </tbody>
      </table></div>
    {/if}
  </section>
{/if}
