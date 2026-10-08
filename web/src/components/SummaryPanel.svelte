<script>
  import { api } from '../lib/api.js';
  import { tr } from '../lib/translation.svelte.js';
  import { view } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';

  /** @type {{ visible: boolean }} */
  let { visible } = $props();

  /** @type {import('../lib/api.js').TranslationStats | null} */
  let stats = $state(null);
  /** @type {import('../lib/api.js').Toc | null} */
  let toc = $state(null);
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
</script>

<section class="group export-box">
  <div class="box-title">Экспорт новой редакции</div>
  <label class="setting-label" for="exp-scope">Объём</label>
  <select id="exp-scope" class="text-input" bind:value={scope}>
    <option value="all">Вся книга</option>
    {#if toc}
      {#each toc.parts as p (p.id)}<option value="part:{p.id}">Часть {ROMAN[p.id] ?? p.id}. {p.titleRu}</option>{/each}
      {#each toc.papers as p (p.id)}<option value="paper:{p.id}">{p.id === 0 ? 'Предисловие' : `Текст ${p.id}. ${p.titleRu}`}</option>{/each}
    {/if}
  </select>
  <div class="setting-label">Язык</div>
  <div class="segmented small-seg" role="radiogroup" aria-label="Язык">
    <button role="radio" aria-checked={lang === 'ru'} class:active={lang === 'ru'} onclick={() => (lang = 'ru')}>Русский</button>
    <button role="radio" aria-checked={lang === 'ruen'} class:active={lang === 'ruen'} onclick={() => (lang = 'ruen')}>Русский + английский</button>
  </div>
  <p class="hint">Markdown: принятые варианты стоят на месте исходных, курсив сохраняется.</p>
  <label class="toggle"><input type="checkbox" bind:checked={withChanges} /><span>Приложить список изменений</span></label>
  <div class="row-end">
    <a class="btn" href={csvHref} download title="Таблица для Excel: абзац, было, стало, автор, дата, голоса">Изменения (CSV)</a>
    <a class="btn primary" href={href} download>Скачать Markdown</a>
  </div>
</section>

{#if error}<div class="search-error">{error}</div>{/if}
{#if stats}
  <section class="stats">
    <div class="box-title">Ход работы</div>
    <div class="stat-cards">
      <div class="stat-card"><b>{stats.totals.approved}</b><span>принято</span></div>
      <div class="stat-card"><b>{stats.totals.voting}</b><span>на голосовании</span></div>
      <div class="stat-card"><b>{stats.totals.draft}</b><span>в черновиках</span></div>
      <div class="stat-card"><b>{stats.totals.rejected}</b><span>отклонено</span></div>
    </div>
    <p class="hint">
      Изменено {changedTotal} {plural(changedTotal, 'абзац', 'абзаца', 'абзацев')} из {stats.paragraphs.toLocaleString('ru')}
      ({pct(changedTotal, stats.paragraphs)}%).
    </p>

    {#if stats.byPaper.length}
      <div class="box-title">По Текстам</div>
      <ol class="stat-papers">
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
      <div class="box-title">Участники</div>
      <table class="stat-people">
        <thead><tr><th></th><th title="Опубликовано на голосование">Предл.</th><th>Принято</th><th>Голоса</th><th title="Сообщения в обсуждениях">Сообщ.</th></tr></thead>
        <tbody>
          {#each stats.people as u (u.id)}
            <tr><td class="ellipsis">{u.name}</td><td>{u.proposed}</td><td>{u.approved}</td><td>{u.votes}</td><td>{u.messages}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}
