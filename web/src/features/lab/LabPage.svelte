<script>
  import { navigate } from '../../lib/router.svelte.js';
  import { plural } from '../../lib/format.js';
  import { showToast } from '../../lib/toast.svelte.js';
  import { labApi } from './api.js';
  import Icon from '../../components/Icon.svelte';

  /**
   * The Laboratory (an administrator's): the search by meaning tried on the book. The models — how much of
   * the book each has worked out (in the background, at a lower priority: nobody else is held up), to go on
   * or pause; a question — the closest paragraphs of each model beside the word search («Я и Книга»'s);
   * the saved questions to try again.
   */
  let status = $state(/** @type {import('./api.js').Status | null} */ (null));
  let error = $state('');
  let text = $state('');
  let asking = $state(false);
  let answer = $state(/** @type {import('./api.js').Answer | null} */ (null));

  const load = () => labApi.status().then((s) => ((status = s), (error = '')), (e) => (error = e.message));
  load();
  // while a model works: its progress every few seconds
  $effect(() => {
    if (!status?.models.some((m) => m.running)) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  });

  /** @param {() => Promise<import('./api.js').Status>} call */
  async function act(call) {
    try {
      status = await call();
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }

  /** @param {string} [q] */
  async function ask(q = text) {
    q = q.trim();
    if (!q || asking) return;
    text = q;
    asking = true;
    try {
      answer = await labApi.ask(q);
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    } finally {
      asking = false;
    }
  }

  const n = (/** @type {number} */ x) => x.toLocaleString('ru');
  /** @param {import('./api.js').Model} m */
  function progress(m) {
    const pct = m.total ? Math.floor((m.done / m.total) * 100) : 0;
    let s = `${n(m.done)} из ${n(m.total)} (${pct}%)`;
    if (m.running && m.rate) {
      const left = Math.ceil((m.total - m.done) / m.rate);
      s += ` · ${n(m.rate)} в минуту · осталось ≈ ${left < 60 ? `${left} мин` : `${Math.floor(left / 60)} ч ${left % 60} мин`}`;
    }
    return s;
  }
  const columns = $derived(
    !answer || !status ? [] : [
      ...status.models.filter((m) => answer?.models[m.id]).map((m) => ({ id: m.id, title: m.title, result: /** @type {NonNullable<typeof answer>} */ (answer).models[m.id] })),
      { id: 'words', title: 'По словам («Я и Книга»)', result: { ms: 0, found: answer.words } },
    ],
  );
  const snippet = (/** @type {string} */ s) => (s.length > 260 ? `${s.slice(0, 260)}…` : s);
</script>

<div class="lab-page">
  <div class="lab-inner">
    <h1 class="lab-h">Лаборатория</h1>
    <p class="muted lab-lead">Поиск по смыслу — эксперимент. Видите только вы; остальным он не мешает: модель работает отдельно и не спеша.</p>

    {#if error}
      <p class="muted">{error}</p>
    {:else if !status}
      <p class="muted">Загрузка…</p>
    {:else}
      {#if !status.installed}<p class="ui-hint">Движок модели не установлен: <code>npm install</code> в server/features/lab/engine.</p>{/if}

      <div class="ui-label">Модели</div>
      <ul class="ui-cards">
        {#each status.models as m (m.id)}
          <li class="ui-card lab-model">
            <span class="lab-model-text">
              <b>{m.title} <span class="muted lab-size">{m.size}{m.downloaded ? '' : ' · скачается при запуске'}</span></b>
              <span class="lab-bar" aria-hidden="true"><span style:width="{m.total ? (m.done / m.total) * 100 : 0}%"></span></span>
              <span class="muted small">{m.done || m.running ? progress(m) : 'Ещё не считали'}{m.running ? ' · считается' : ''}</span>
              {#if m.error}<span class="lab-error small">{m.error}</span>{/if}
            </span>
            {#if m.running}
              <button class="ui-chip" onclick={() => act(labApi.pause)}><Icon name="pause" size={14} />Пауза</button>
            {:else if m.done < m.total}
              <button class="ui-chip" onclick={() => act(() => labApi.run(m.id))} disabled={!status.installed}><Icon name="play" size={14} />{m.done ? 'Дальше' : 'Посчитать'}</button>
            {/if}
          </li>
        {/each}
      </ul>

      <div class="ui-label">Вопрос</div>
      <form class="lab-ask" onsubmit={(e) => (e.preventDefault(), ask())}>
        <label class="ui-search lab-field">
          <Icon name="search" size={18} />
          <input bind:value={text} placeholder="Например: что происходит с человеком после смерти?" maxlength="500" aria-label="Вопрос" />
        </label>
        <button class="ui-chip on" disabled={asking || !text.trim()}>{asking ? 'Ищу…' : 'Спросить'}</button>
        <button type="button" class="ui-chip" disabled={!text.trim()} onclick={() => act(() => labApi.addQuestion(text))} title="В набор вопросов для проверки">Сохранить</button>
      </form>
      {#if status.questions.length}
        <div class="ui-chips lab-questions">
          {#each status.questions as q (q.id)}
            <span class="ui-chip lab-q">
              <button class="lab-q-text" onclick={() => ask(q.text)}>{q.text}</button>
              <button class="lab-q-x" aria-label="Убрать вопрос" onclick={() => act(() => labApi.removeQuestion(q.id))}><Icon name="close" size={12} /></button>
            </span>
          {/each}
        </div>
      {/if}
      {#if answer && !status.models.some((m) => m.done)}<p class="muted">Ни одна модель ещё не посчитана — пока только поиск по словам.</p>{/if}
    {/if}
  </div>

  {#if columns.length}
    <!-- the answers side by side: each model, and the word search -->
    <div class="lab-columns" style:--cols={columns.length}>
      {#each columns as c (c.id)}
        <section class="lab-col">
          <h2 class="lab-col-h">{c.title}{#if 'ms' in c.result && c.result.ms}<span class="muted small"> · {c.result.ms} мс</span>{/if}</h2>
          {#if 'error' in c.result}
            <p class="lab-error small">{c.result.error}</p>
          {:else if !c.result.found.length}
            <p class="muted small">Ничего не найдено.</p>
          {:else}
            <ol class="lab-found">
              {#each c.result.found as f, i (f.ref)}
                <li>
                  <a class="lab-hit" href="/{f.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${f.ref}`))}>
                    <span class="lab-hit-head">
                      <b>{i + 1}. {f.ref}</b>
                      {#if f.score !== undefined}<span class="lab-score" title="Близость по смыслу (1 — то же самое)">{f.score.toFixed(3)}</span>{/if}
                      {#if f.lang === 'en'}<span class="lab-lang" title="Ближе всего оказался английский текст абзаца">EN</span>{/if}
                      <span class="muted ellipsis">{f.paperTitle}</span>
                    </span>
                    <span class="lab-hit-text" lang={f.lang === 'en' ? 'en' : 'ru'}>{snippet(f.lang === 'en' ? f.en : f.ru)}</span>
                  </a>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      {/each}
    </div>
    <p class="muted small lab-foot">{columns.length - 1 ? `${columns.length - 1} ${plural(columns.length - 1, 'модель', 'модели', 'моделей')} и поиск по словам` : 'Поиск по словам'} · абзац откроется в книге</p>
  {/if}
</div>

<style>
  .lab-page {
    height: 100%;
    overflow: auto;
    background: var(--bg);
    padding-bottom: var(--space-16);
  }
  .lab-inner {
    display: grid;
    gap: var(--space-3);
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-4);
  }
  .lab-h {
    margin: 0;
    font: 600 26px/32px var(--sans);
  }
  .lab-lead {
    margin: 0;
  }
  .lab-model {
    align-items: center;
  }
  .lab-model-text {
    display: grid;
    flex: 1;
    gap: 6px;
    min-width: 0;
  }
  .lab-size {
    font-weight: 400;
  }
  .lab-bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--ui-fill-2);
    overflow: hidden;
  }
  .lab-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.4s;
  }
  .lab-error {
    color: var(--danger, #b42318);
  }
  .lab-ask {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .lab-field {
    flex: 1 1 320px;
  }
  .lab-questions {
    flex-wrap: wrap;
  }
  .lab-q {
    gap: 2px;
    padding-right: 4px;
  }
  .lab-q-text,
  .lab-q-x {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .lab-q-x {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--muted);
  }
  .lab-q-x:hover {
    background: var(--ui-fill-2);
  }
  .lab-columns {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-4);
    max-width: calc(var(--cols) * 420px);
    margin: var(--space-4) auto 0;
    padding: 0 var(--space-4);
  }
  @media (max-width: 900px) {
    .lab-columns {
      grid-template-columns: 1fr;
    }
  }
  .lab-col-h {
    margin: 0 0 var(--space-2);
    font: 600 15px/20px var(--sans);
  }
  .lab-found {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .lab-hit {
    display: grid;
    gap: 4px;
    padding: var(--space-3);
    border: 1px solid var(--ui-line);
    border-radius: 14px;
    background: var(--ui-card);
    color: var(--text);
    text-decoration: none;
  }
  .lab-hit:hover {
    border-color: color-mix(in srgb, var(--text) 25%, transparent);
  }
  .lab-hit-head {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    min-width: 0;
    font: 13px/18px var(--sans);
  }
  .lab-score {
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .lab-lang {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--ui-fill-2);
    font-size: 11px;
  }
  .lab-hit-text {
    font: 14px/1.5 var(--text-font, var(--serif));
  }
  .lab-foot {
    max-width: 760px;
    margin: var(--space-3) auto 0;
    padding: 0 var(--space-4);
  }
</style>
