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
  const snippet = (/** @type {string} */ s) => (s.length > 260 ? `${s.slice(0, 260)}…` : s);

  /**
   * The paragraph answers the question (or not) — in every column at once; the same again: not judged.
   * @param {string} ref @param {boolean} good
   */
  async function judge(ref, good) {
    if (!answer) return;
    const next = answer.judged[ref] === good ? null : good;
    const judged = { ...answer.judged };
    if (next === null) delete judged[ref];
    else judged[ref] = next;
    answer.judged = judged;
    await act(() => labApi.judge({ question: /** @type {NonNullable<typeof answer>} */ (answer).text, ref, good: next }));
  }

  /** Every saved question asked again (a new model, the mixed one: their answers into the score). */
  let again = $state(/** @type {{ done: number, of: number } | null} */ (null));
  async function askAll() {
    if (!status || again) return;
    const list = [...status.questions].reverse();
    again = { done: 0, of: list.length };
    try {
      for (const q of list) {
        await labApi.ask(q.text);
        again = { done: again.done + 1, of: list.length };
      }
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    } finally {
      again = null;
      await load();
      if (answer) await ask(answer.text);
    }
  }
  /** The score's name of a column. @param {string} id */
  const titleOf = (id) =>
    id === 'words' ? 'По словам' : id === 'mix' ? 'Смешанный' : id; // (the models by their short names: e5-base, bge-m3)
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
              <button class="lab-q-text" onclick={() => ask(q.text)} title={q.open ? `Не отмечено: ${q.open}` : 'Все ответы отмечены'}>{q.text}{#if q.good || q.bad || q.open}<span class="lab-q-n">
                {#if q.good}<span class="lab-good">✓{q.good}</span>{/if}{#if q.bad}<span class="lab-bad">✗{q.bad}</span>{/if}{#if q.open}<span class="muted">·{q.open}</span>{/if}</span>{/if}</button>
              <button class="lab-q-x" aria-label="Убрать вопрос" onclick={() => act(() => labApi.removeQuestion(q.id))}><Icon name="close" size={12} /></button>
            </span>
          {/each}
        </div>
        <button class="ui-chip lab-again" onclick={askAll} disabled={!!again}>
          <Icon name="reset" size={14} />{again ? `Задаю ${again.done} из ${again.of}…` : 'Задать все вопросы заново'}</button>
      {/if}
      {#if status.score.length}
        <!-- the score: who finds what the reader meant; what matters most — a hit among the first three («Я и Книга» answers with three) -->
        <div class="ui-label">Счёт по отметкам</div>
        <div class="lab-table" role="table" aria-label="Счёт по отметкам">
          <div class="lab-tr lab-th" role="row">
            <span role="columnheader">Поиск</span>
            <span role="columnheader" title="Хотя бы одно попадание среди первых трёх абзацев">Первые 3</span>
            <span role="columnheader" title="Хотя бы одно попадание среди всех десяти">Хоть раз</span>
            <span role="columnheader" class="lab-good">✓</span>
            <span role="columnheader" class="lab-bad">✗</span>
            <span role="columnheader" title="Ещё не отмечено">?</span>
          </div>
          {#each status.score as s (s.col)}
            <div class="lab-tr" role="row">
              <b role="cell">{titleOf(s.col)}</b>
              <span role="cell">{s.top3} из {s.asked}</span>
              <span role="cell">{s.answered} из {s.asked}</span>
              <span role="cell" class="lab-good">{s.good}</span>
              <span role="cell" class="lab-bad">{s.bad}</span>
              <span role="cell" class="muted">{s.open}</span>
            </div>
          {/each}
        </div>
        <p class="muted small lab-note">«Из N» — сколько вопросов задано этому поиску. «?» — найденные абзацы без отметки: отметьте их, и счёт станет точнее.</p>
      {/if}
      {#if answer && !status.models.some((m) => m.done)}<p class="muted">Ни одна модель ещё не посчитана — пока только поиск по словам.</p>{/if}
    {/if}
  </div>

  {#if answer?.columns.length}
    <!-- the answers side by side: each model, the mixed one, the word search; a judgement shows in all of them -->
    <div class="lab-columns" style:--cols={answer.columns.length}>
      {#each answer.columns as c (c.id)}
        <section class="lab-col">
          <h2 class="lab-col-h">{c.title}{#if 'ms' in c && c.ms}<span class="muted small"> · {c.ms} мс</span>{/if}</h2>
          {#if 'error' in c}
            <p class="lab-error small">{c.error}</p>
          {:else if !c.found.length}
            <p class="muted small">Ничего не найдено.</p>
          {:else}
            <ol class="lab-found">
              {#each c.found as f, i (f.ref)}
                {@const m = answer.judged[f.ref]}
                <li class="lab-item" class:good={m === true} class:bad={m === false}>
                  <!-- answers the question / not: one judgement for the paragraph, in every column -->
                  <span class="lab-marks">
                    <button class="lab-mark lab-mark-good" class:on={m === true} aria-pressed={m === true} title="Попал: этот абзац отвечает на вопрос"
                      aria-label="Попал: {f.ref}" onclick={() => judge(f.ref, true)}><Icon name="check" size={16} /></button>
                    <button class="lab-mark lab-mark-bad" class:on={m === false} aria-pressed={m === false} title="Мимо: не об этом"
                      aria-label="Мимо: {f.ref}" onclick={() => judge(f.ref, false)}><Icon name="close" size={16} /></button>
                  </span>
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
    <p class="muted small lab-foot">Отметка относится к абзацу и видна во всех колонках · абзац откроется в книге</p>
  {/if}
</div>

<style>
  .lab-page {
    height: 100%;
    overflow: auto;
    overflow-x: hidden;
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
    max-width: 100%;
    height: auto;
    min-height: 36px;
    padding-right: 4px;
    white-space: normal;
  }
  .lab-q-text {
    text-align: left;
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
  .lab-item {
    position: relative;
  }
  /* the marks: at the card's top right corner, a thumb's size */
  .lab-marks {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
  }
  .lab-mark {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--ui-line);
    border-radius: 50%;
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
  }
  .lab-mark-good.on {
    border-color: #15803d;
    background: #15803d;
    color: #fff;
  }
  .lab-mark-bad.on {
    border-color: #b42318;
    background: #b42318;
    color: #fff;
  }
  .lab-item.good .lab-hit {
    border-color: color-mix(in srgb, #15803d 55%, transparent);
  }
  .lab-item.bad .lab-hit {
    opacity: 0.6;
  }
  .lab-good {
    color: #15803d;
  }
  .lab-bad {
    color: #b42318;
  }
  .lab-q-n {
    display: inline-flex;
    gap: 4px;
    margin-left: 6px;
    font-size: 12px;
  }
  .lab-again {
    justify-self: start;
  }
  .lab-table {
    display: grid;
    border: 1px solid var(--ui-line);
    border-radius: 14px;
    overflow: hidden;
  }
  .lab-tr {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) repeat(2, minmax(0, 1fr)) repeat(3, 36px);
    gap: var(--space-2);
    align-items: baseline;
    padding: 8px 12px;
    font: 14px/20px var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .lab-tr + .lab-tr {
    border-top: 1px solid var(--ui-line);
  }
  .lab-th {
    background: var(--ui-fill);
    color: var(--muted);
    font-size: 12px;
  }
  .lab-tr b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lab-note {
    margin: 0;
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
    /* (room for the marks at the right) */
    min-height: 30px;
    padding-right: 84px;
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    min-width: 0;
    font: 13px/18px var(--sans);
  }
  .lab-hit-head b,
  .lab-score {
    flex: none;
    white-space: nowrap;
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
