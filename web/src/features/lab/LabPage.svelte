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
  // while a model works: its progress every few seconds (and the written answers, if open)
  $effect(() => {
    if (!status?.models.some((m) => m.running || m.queued) && !status?.writers.some((w) => w.running)) return;
    const t = setInterval(() => {
      load();
      if (replies) labApi.replies().then((r) => (replies = r), () => {});
    }, 3000);
    return () => clearInterval(t);
  });

  // ---- The application's AI: a service connected by a sign-in in the browser (OAuth); the remote models answer through it ----
  let ai = $state(/** @type {import('./api.js').AiConnection | null | undefined} */ (undefined));
  const loadAi = () => labApi.aiApp().then((a) => (ai = a), () => (ai = null));
  loadAi();
  {
    // back from the service's sign-in: ?ai=connected, or why not
    const back = new URLSearchParams(location.search).get('ai');
    if (back) {
      showToast(back === 'connected' ? 'Нейросеть подключена' : back);
      history.replaceState(history.state, '', location.pathname);
    }
  }
  async function connectAi() {
    try {
      location.href = (await labApi.connectAi('openrouter', '/lab')).url;
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }
  async function disconnectAi() {
    try {
      await labApi.disconnectAi();
      await Promise.all([loadAi(), load()]);
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }

  // ---- The Book's answers in its own words: the writing models, their answers to the saved questions ----
  let replies = $state(/** @type {import('./api.js').Reply[] | null} */ (null));
  async function toggleReplies() {
    if (replies) return void (replies = null);
    try {
      replies = await labApi.replies();
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }
  /** @param {string} question @param {string} model @param {boolean} good */
  async function judgeReply(question, model, good) {
    const r = replies?.find((x) => x.question === question)?.answers[model];
    if (!r) return;
    r.good = r.good === good ? null : good;
    await act(() => labApi.judgeReply({ question, model, good: r.good }));
  }
  /** The answer's text with its paragraphs' numbers as links. @param {string} text */
  const pieces = (text) => text.split(/(\d{1,3}:\d{1,2}\.\d{1,3})/);
  const secs = (/** @type {number} */ ms) => `${Math.round(ms / 1000)} с`;

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
  // ---- What is left to judge: every paragraph once, per question (whichever columns found it) ----
  let todo = $state(/** @type {import('./api.js').Todo[] | null} */ (null));
  /** Judged here (kept on screen to change one's mind): "question\nref" → hit. @type {Record<string, boolean>} */
  let done = $state({});
  const openTotal = $derived(status?.questions.reduce((n, q) => n + q.open, 0) ?? 0);
  async function toggleTodo() {
    if (todo) return void (todo = null);
    try {
      done = {};
      todo = await labApi.todo();
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }
  /** @param {string} question @param {string} ref @param {boolean} good */
  async function judgeOpen(question, ref, good) {
    const key = `${question}\n${ref}`;
    const next = done[key] === good ? null : good;
    const d = { ...done };
    if (next === null) delete d[key];
    else d[key] = next;
    done = d;
    await act(() => labApi.judge({ question, ref, good: next }));
  }

  /** The score's name of a column. @param {string} id */
  const titleOf = (id) =>
    id === 'words' ? 'По словам' : id === 'mix' ? 'Смешанный' : id === 'book' ? 'Я и Книга' : id; // (the models by their short names: e5-base, bge-m3)
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

      <!-- how the vectors are worked out: the processor's threads, the video card, all models at once -->
      {@const set = status.settings}
      <div class="ui-label">Как считать</div>
      <div class="set-card">
        <div class="set-item set-switch lab-threads">
          <span class="set-item-text"><b>Потоки процессора</b>
            <span>Сколько ядер отдать моделям. При одновременном расчёте делятся между моделями на процессоре.</span></span>
          <span class="lab-step">
            <button class="ui-chip" aria-label="Меньше потоков" disabled={set.threads <= 1} onclick={() => act(() => labApi.configure({ threads: set.threads - 1 }))}>−</button>
            <b class="lab-step-n" aria-live="polite">{set.threads}</b>
            <button class="ui-chip" aria-label="Больше потоков" disabled={set.threads >= set.maxThreads} onclick={() => act(() => labApi.configure({ threads: set.threads + 1 }))}>+</button>
          </span>
        </div>
        <!-- (the video card and all at once: only when there is a model for it, and more than one) -->
        {#if status.models.some((m) => m.gpu)}
        <label class="set-item set-switch">
          <span class="set-item-text"><b>Видеокарта</b>
            <span>Модели полной точности ({status.models.filter((m) => m.gpu).map((m) => m.id).join(', ')}) — в 6–7 раз быстрее, векторы те же. Остальные считаются на процессоре.</span></span>
          <input type="checkbox" class="ui-switch" checked={set.gpu} onchange={(e) => act(() => labApi.configure({ gpu: e.currentTarget.checked }))} />
        </label>
        {/if}
        {#if status.models.length > 1}
        <label class="set-item set-switch">
          <span class="set-item-text"><b>Все модели сразу</b>
            <span>Каждая в своём процессе, а не по очереди. Памяти нужно больше.</span></span>
          <input type="checkbox" class="ui-switch" checked={set.together} onchange={(e) => act(() => labApi.configure({ together: e.currentTarget.checked }))} />
        </label>
        {/if}
      </div>

      <div class="ui-label lab-models-h">Модели
        {#if status.models.some((m) => m.running || m.queued)}
          <button class="ui-chip" onclick={() => act(() => labApi.pause())}><Icon name="pause" size={14} />Остановить все</button>
        {:else if status.models.some((m) => m.done < m.total)}
          <button class="ui-chip" onclick={() => act(labApi.runAll)} disabled={!status.installed}><Icon name="play" size={14} />Посчитать все</button>
        {/if}
      </div>
      <ul class="ui-cards">
        {#each status.models as m (m.id)}
          <li class="ui-card lab-model">
            <span class="lab-model-text">
              <b>{m.title} <span class="muted lab-size">{m.size}{m.downloaded ? '' : ' · скачается при запуске'}</span></b>
              <span class="lab-bar" aria-hidden="true"><span style:width="{m.total ? (m.done / m.total) * 100 : 0}%"></span></span>
              <span class="muted small">{m.done || m.running ? progress(m) : 'Ещё не считали'}{m.running ? ` · считается ${m.device === 'gpu' ? 'на видеокарте' : `на процессоре, ${m.threads} ${plural(m.threads ?? 0, 'поток', 'потока', 'потоков')}`}` : m.queued ? ' · в очереди' : ''}</span>
              {#if m.error}<span class="lab-error small">{m.error}</span>{/if}
            </span>
            {#if m.running}
              <button class="ui-chip" onclick={() => act(() => labApi.pause(m.id))}><Icon name="pause" size={14} />Пауза</button>
            {:else if m.queued}
              <button class="ui-chip" onclick={() => act(() => labApi.pause(m.id))} title="Убрать из очереди">В очереди</button>
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
              <span role="cell">{s.top3}/{s.asked}</span>
              <span role="cell">{s.answered}/{s.asked}</span>
              <span role="cell" class="lab-good">{s.good}</span>
              <span role="cell" class="lab-bad">{s.bad}</span>
              <span role="cell" class="muted">{s.open}</span>
            </div>
          {/each}
        </div>
        <p class="muted small lab-note">«3/10» — в трёх вопросах из десяти, заданных этому поиску. «?» — найденные абзацы без отметки: отметьте их, и счёт станет точнее.</p>
      {/if}
      {#if status.writers.length}
        <!-- the Book's answers in its own words: each writing model answers the saved questions from the paragraphs found by meaning -->
        <div class="ui-label">Ответы своими словами</div>
        <!-- the application's AI: the remote models answer through it (the shared answers of the day, later) -->
        <ul class="ui-cards">
          <li class="ui-card lab-model">
            <span class="lab-model-text">
              <b>Нейросеть приложения</b>
              <span class="muted small">{ai === undefined ? 'Загрузка…' : ai
                ? `${ai.title} · подключена ${new Date(`${ai.since.replace(' ', 'T')}Z`).toLocaleDateString('ru')}`
                : 'Не подключена. Вход через браузер — аккаунт OpenRouter; его бесплатные модели отвечают за приложение'}</span>
            </span>
            {#if ai}
              <button class="ui-chip" onclick={disconnectAi}>Отключить</button>
            {:else if ai === null}
              <button class="ui-chip on" onclick={connectAi}>Подключить</button>
            {/if}
          </li>
        </ul>
        <ul class="ui-cards">
          {#each status.writers as w (w.id)}
            <li class="ui-card lab-model">
              <span class="lab-model-text">
                <b>{w.title} <span class="muted lab-size">{w.size}{w.downloaded ? '' : ' · скачается при запуске'}</span></b>
                <span class="muted small">
                  {#if w.progress}Отвечает: {w.progress.done} из {w.progress.of}…{:else}Ответила на {w.answered} из {w.of}{/if}
                  {#if w.good || w.bad} · <span class="lab-good">✓{w.good}</span> <span class="lab-bad">✗{w.bad}</span>{/if}
                  {#if w.ms} · ≈ {secs(w.ms)} на ответ{/if}
                </span>
                {#if w.error}<span class="lab-error small">{w.error}</span>{/if}
              </span>
              {#if w.running}
                <button class="ui-chip" onclick={() => act(labApi.pauseWriting)}><Icon name="pause" size={14} />Пауза</button>
              {:else if !w.ready}
                <button class="ui-chip" disabled title="Сначала подключите нейросеть приложения">Нет подключения</button>
              {:else if w.answered < w.of}
                <button class="ui-chip" onclick={() => act(() => labApi.write(w.id))} disabled={!status.installed || status.writers.some((x) => x.running)}>
                  <Icon name="play" size={14} />{w.answered ? 'Дальше' : 'Ответить'}</button>
              {:else if w.of}
                <button class="ui-chip" onclick={() => act(() => labApi.write(w.id, true))} disabled={status.writers.some((x) => x.running)}>
                  <Icon name="reset" size={14} />Заново</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if status.writers.some((w) => w.answered)}
          <button class="ui-chip on lab-todo-btn" onclick={toggleReplies}>{replies ? 'Скрыть ответы' : 'Показать ответы и отметить'}</button>
        {/if}
        {#if replies}
          {#each replies as r (r.question)}
            <section class="lab-todo">
              <h2 class="lab-todo-q">{r.question}</h2>
              <span class="muted small">по абзацам: {#each r.refs as ref, i (ref)}{i ? ', ' : ''}<a href="/{ref}" onclick={(e) => (e.preventDefault(), navigate(`/${ref}`))}>{ref}</a>{/each}</span>
              <ol class="lab-found">
                {#each status.writers.filter((w) => r.answers[w.id]) as w (w.id)}
                  {@const a = r.answers[w.id]}
                  <li class="lab-item" class:good={a.good === true} class:bad={a.good === false}>
                    <span class="lab-marks">
                      <button class="lab-mark lab-mark-good" class:on={a.good === true} aria-pressed={a.good === true} title="Верно: по тексту и по существу"
                        aria-label="Верно: {w.title}" onclick={() => judgeReply(r.question, w.id, true)}><Icon name="check" size={16} /></button>
                      <button class="lab-mark lab-mark-bad" class:on={a.good === false} aria-pressed={a.good === false} title="Неверно: выдумала, исказила или мимо"
                        aria-label="Неверно: {w.title}" onclick={() => judgeReply(r.question, w.id, false)}><Icon name="close" size={16} /></button>
                    </span>
                    <div class="lab-hit">
                      <span class="lab-hit-head"><b>{w.title}</b><span class="muted">{secs(a.ms)}</span></span>
                      <span class="lab-hit-text">{#each pieces(a.text) as p, i (i)}{#if i % 2}<a href="/{p}" onclick={(e) => (e.preventDefault(), navigate(`/${p}`))}>{p}</a>{:else}{p}{/if}{/each}</span>
                    </div>
                  </li>
                {/each}
              </ol>
            </section>
          {/each}
        {/if}
      {/if}
      {#if openTotal || todo}
        <!-- what is left to judge: every paragraph once, whichever columns found it -->
        <button class="ui-chip on lab-todo-btn" onclick={toggleTodo}>
          {todo ? 'Скрыть список' : `Отметить абзацы без отметки (${openTotal})`}</button>
      {/if}
      {#if todo}
        {#if !todo.length}<p class="muted">Всё отмечено.</p>{/if}
        {#each todo as t (t.question)}
          {@const left = t.items.filter((x) => done[`${t.question}\n${x.ref}`] === undefined).length}
          <section class="lab-todo">
            <h2 class="lab-todo-q">{t.question} <span class="muted small">· осталось {left} из {t.items.length}</span></h2>
            <ol class="lab-found">
              {#each t.items as f (f.ref)}
                {@const m = done[`${t.question}\n${f.ref}`]}
                <li class="lab-item" class:good={m === true} class:bad={m === false}>
                  <span class="lab-marks">
                    <button class="lab-mark lab-mark-good" class:on={m === true} aria-pressed={m === true} title="Попал: этот абзац отвечает на вопрос"
                      aria-label="Попал: {f.ref}" onclick={() => judgeOpen(t.question, f.ref, true)}><Icon name="check" size={16} /></button>
                    <button class="lab-mark lab-mark-bad" class:on={m === false} aria-pressed={m === false} title="Мимо: не об этом"
                      aria-label="Мимо: {f.ref}" onclick={() => judgeOpen(t.question, f.ref, false)}><Icon name="close" size={16} /></button>
                  </span>
                  <a class="lab-hit" href="/{f.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${f.ref}`))}>
                    <span class="lab-hit-head"><b>{f.ref}</b><span class="muted ellipsis">{f.paperTitle}</span></span>
                    <span class="muted small">нашли: {f.by.map((b) => `${titleOf(b.col)} — ${b.rank}-м`).join(', ')}</span>
                    <span class="lab-hit-text">{f.ru}</span>
                  </a>
                </li>
              {/each}
            </ol>
          </section>
        {/each}
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
  .lab-models-h {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }
  .lab-step {
    display: flex;
    flex: none;
    gap: var(--space-2);
    align-items: center;
  }
  .lab-threads {
    cursor: default;
  }
  .lab-step .ui-chip {
    justify-content: center;
    width: 36px;
    padding: 0;
    font-size: 18px;
  }
  .lab-step-n {
    min-width: 2ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .lab-model-text {
    display: grid;
    flex: 1;
    gap: 6px;
    min-width: 0;
  }
  .lab-size {
    font-weight: 400;
    white-space: nowrap;
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
  .lab-todo-btn {
    justify-self: start;
  }
  .lab-todo {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .lab-todo-q {
    margin: 0;
    font: 600 16px/22px var(--sans);
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
