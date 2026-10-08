<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { tasks, loadTasks, createTask, patchTask, patchSubtask, orderTasks, createList, updateList, deleteList, today, placeLabel } from '../lib/tasks.svelte.js';
  import { navigate, route, lastPath } from '../lib/router.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';
  import Drawer from './Drawer.svelte';
  import TaskEditor from './TaskEditor.svelte';

  /** @typedef {import('../lib/api.js').Task} Task */

  onMount(() => {
    void loadTasks(true);
  });

  // ---- Where we are: section (or list), view, search, a paragraph filter from the reader ----
  const VIEW_KEY = 'ub.tasksView';
  let section = $state(/** @type {string} */ ('all'));
  let view = $state(/** @type {'list' | 'kanban'} */ (readView()));
  let query = $state('');
  let refFilter = $state(/** @type {string | null} */ (null));
  /** @type {number | null} */ let expanded = $state(null);
  let showDone = $state(false);

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'kanban' ? 'kanban' : 'list';
    } catch {
      return 'list';
    }
  }
  /** @param {'list' | 'kanban'} v */
  function setView(v) {
    view = v;
    expanded = null;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }
  // /tasks?ref=5:1.2 — tasks of one paragraph (from the marker in the book's margin).
  $effect(() => {
    void route.nav;
    refFilter = new URLSearchParams(location.search).get('ref');
  });

  const t0 = $derived(today());
  const t1 = $derived(today(1));
  const t7 = $derived(today(7));

  /** @param {Task} t */
  function matches(t) {
    if (refFilter && t.ref !== refFilter && !(t.refEnd && t.ref && covers(t, refFilter))) return false;
    const q = query.trim().toLowerCase();
    if (q && ![t.title, t.notes ?? '', t.tags.join(' '), t.ref ?? ''].some((s) => s.toLowerCase().includes(q))) return false;
    if (section === 'today') return t.due !== null && t.due <= t0;
    if (section === 'upcoming') return t.due !== null && t.due > t0;
    if (section === 'important') return t.important;
    if (section.startsWith('list:')) return t.listId === Number(section.slice(5));
    return true;
  }
  /** A range "5:1.2–1.4" covers "5:1.3" (same paper and section only — enough for the margin marker). @param {Task} t @param {string} ref */
  function covers(t, ref) {
    const [p, rest] = ref.split(':');
    const [s, n] = rest.split('.').map(Number);
    const [ap, ar] = /** @type {string} */ (t.ref).split(':');
    const [as, an] = ar.split('.').map(Number);
    const [, er] = /** @type {string} */ (t.refEnd).split(':');
    const [es, en] = er.split('.').map(Number);
    return p === ap && (s > as || (s === as && n >= an)) && (s < es || (s === es && n <= en));
  }
  // Manual order (drag and drop); importance shows by the red circle, as in the reference.
  const byOrder = (/** @type {Task} */ a, /** @type {Task} */ b) => a.pos - b.pos || b.id - a.id;
  const shown = $derived(tasks.items.filter(matches));
  const active = $derived(shown.filter((t) => t.status !== 'done').sort(byOrder));
  const done = $derived(shown.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')));

  /** List view groups by due date. */
  const groups = $derived.by(() => {
    /** @type {[string, string, Task[]][]} */
    const g = [['overdue', 'Просрочено', []], ['today', 'Сегодня', []], ['tomorrow', 'Завтра', []], ['week', 'На этой неделе', []], ['later', 'Позже', []], ['none', 'Без срока', []]];
    const at = (/** @type {string} */ k) => /** @type {Task[]} */ (g.find((x) => x[0] === k)?.[2]);
    for (const t of active) {
      if (t.due === null) at('none').push(t);
      else if (t.due < t0) at('overdue').push(t);
      else if (t.due === t0) at('today').push(t);
      else if (t.due === t1) at('tomorrow').push(t);
      else if (t.due <= t7) at('week').push(t);
      else at('later').push(t);
    }
    return g.filter((x) => x[2].length);
  });

  // Counters in the navigation.
  const open = $derived(tasks.items.filter((t) => t.status !== 'done'));
  const counts = $derived({
    all: open.length,
    today: open.filter((t) => t.due !== null && t.due <= t0).length,
    upcoming: open.filter((t) => t.due !== null && t.due > t0).length,
    important: open.filter((t) => t.important).length,
  });
  const SECTIONS = /** @type {const} */ ([['all', 'Все задачи', 'inbox'], ['today', 'Сегодня', 'check-square'], ['upcoming', 'Предстоящие', 'calendar'], ['important', 'Важные', 'star']]);
  const listOf = (/** @type {number | null} */ id) => tasks.lists.find((l) => l.id === id) ?? null;
  const sectionTitle = $derived(
    section.startsWith('list:') ? (() => { const l = listOf(Number(section.slice(5))); return l ? `${l.emoji ?? ''} ${l.title}`.trim() : 'Список'; })()
    : SECTIONS.find((s) => s[0] === section)?.[1] ?? 'Задачи',
  );

  // ---- Quick add: the new task takes the section's context ----
  let newTitle = $state('');
  async function add() {
    const title = newTitle.trim();
    if (!title) return;
    const t = await createTask({
      title,
      listId: section.startsWith('list:') ? Number(section.slice(5)) : null,
      due: section === 'today' ? t0 : null,
      important: section === 'important',
      ref: refFilter,
    });
    if (t) newTitle = '';
  }

  // ---- Lists ----
  let newList = $state('');
  let newEmoji = $state('');
  let editingList = $state(/** @type {number | null} */ (null));
  async function addList() {
    if (!newList.trim()) return;
    const r = await createList(newList.trim(), newEmoji.trim() || null);
    if (r) {
      newList = newEmoji = '';
      section = `list:${r.id}`;
    }
  }

  /** @param {string} due */
  function dueLabel(due) {
    if (due === t0) return 'Сегодня';
    if (due === t1) return 'Завтра';
    if (due === today(-1)) return 'Вчера';
    const d = new Date(`${due}T00:00:00`);
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  }

  // ---- Kanban: drag between columns (status) and within one (order) ----
  const COLUMNS = /** @type {const} */ ([['todo', 'Нужно сделать'], ['doing', 'В работе'], ['done', 'Готово']]);
  /** @param {import('../lib/api.js').TaskStatus} s */
  const column = (s) => shown.filter((t) => t.status === s).sort(s === 'done' ? (a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') : byOrder);
  /** @type {number | null} */ let dragId = $state(null);
  /** @type {string | null} */ let overCol = $state(null);
  /** @param {import('../lib/api.js').TaskStatus} status @param {number | null} beforeId */
  async function dropTo(status, beforeId) {
    const id = dragId;
    dragId = overCol = null;
    if (id === null) return;
    const t = tasks.items.find((x) => x.id === id);
    if (!t) return;
    if (t.status !== status) await patchTask(id, { status });
    if (status === 'done') return;
    const ids = column(status).map((x) => x.id).filter((x) => x !== id);
    ids.splice(beforeId === null ? ids.length : Math.max(0, ids.indexOf(beforeId)), 0, id);
    await orderTasks(ids);
  }
  // The editor opens in a side drawer from both views.
  const editing = $derived(expanded !== null ? tasks.items.find((t) => t.id === expanded) ?? null : null);
  /** Tasks whose subtasks are folded (by default they are shown, as in the reference). */
  const folded = new SvelteSet();
  let adding = $state(false);
  /** @param {Task} t */
  const toggleDone = (t) => patchTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' });

  // ---- List: drag to reorder within a date group, or into "Сегодня / Завтра / Без срока" (sets the due date) ----
  /** Due date a group stands for, when dropping into it means "move here"; undefined: no such move. @param {string} key */
  const groupDue = (key) => (key === 'today' ? t0 : key === 'tomorrow' ? t1 : key === 'none' ? null : undefined);
  /** @type {{ id: number, group: string } | null} */ let dragRow = $state(null);
  /** @type {string | null} */ let overRow = $state(null); // "group:id" or "group:end"
  /** @param {string} group */
  const canDrop = (group) => dragRow !== null && (dragRow.group === group || groupDue(group) !== undefined);
  /** @param {DragEvent} e @param {string} group @param {number | 'end'} at */
  function dragOverRow(e, group, at) {
    if (!canDrop(group)) return;
    e.preventDefault();
    e.stopPropagation();
    overRow = `${group}:${at}`;
  }
  /** @param {string} group @param {number | null} beforeId */
  async function dropRow(group, beforeId) {
    const d = dragRow;
    const allowed = canDrop(group);
    dragRow = null;
    overRow = null;
    if (!d || !allowed || d.id === beforeId) return;
    const target = groups.find((g) => g[0] === group)?.[2] ?? [];
    const ids = target.map((t) => t.id).filter((id) => id !== d.id);
    ids.splice(beforeId === null ? ids.length : Math.max(0, ids.indexOf(beforeId)), 0, d.id);
    if (d.group !== group) await patchTask(d.id, { due: /** @type {string | null} */ (groupDue(group)) });
    await orderTasks(ids);
  }
  /** Alt+↑/↓ on a focused row moves it within its group. @param {KeyboardEvent} e @param {Task} t @param {string} group */
  async function moveByKey(e, t, group) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const ids = (groups.find((g) => g[0] === group)?.[2] ?? []).map((x) => x.id);
    const i = ids.indexOf(t.id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await orderTasks(ids);
    document.getElementById(`task-${t.id}`)?.focus();
  }
</script>

{#snippet check(/** @type {Task} */ t)}
  <button class="task-circle" class:important={t.important} class:checked={t.status === 'done'} onclick={() => toggleDone(t)}
    role="checkbox" aria-checked={t.status === 'done'} aria-label={t.status === 'done' ? 'Вернуть в работу' : 'Готово'}>
    {#if t.status === 'done'}<Icon name="check" size={12} />{/if}
  </button>
{/snippet}

{#snippet due(/** @type {Task} */ t)}
  {#if t.due}
    <span class="task-due" class:overdue={t.status !== 'done' && t.due < t0} class:soon={t.due === t0}><Icon name="calendar" size={13} />{dueLabel(t.due)}</span>
  {/if}
{/snippet}

{#snippet meta(/** @type {Task} */ t)}
  {@const l = t.listId !== null && !section.startsWith('list:') ? listOf(t.listId) : null}
  {#if l || t.ref || t.collectionId || t.tags.length}
    <div class="task-meta">
      {#if l}<span>{l.title} {l.emoji ?? ''}</span>{/if}
      {#if t.ref}
        <a class="task-place" href="/{t.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${t.ref}`))} title={t.paperTitle ?? 'Открыть в книге'}>
          <Icon name="book-open" size={12} />{placeLabel(t)}
        </a>
      {/if}
      {#if t.collectionId}
        <a class="task-place" href="/c/{t.collectionId}" onclick={(e) => (e.preventDefault(), navigate(`/c/${t.collectionId}`))}><Icon name="layers" size={12} />{t.collectionTitle ?? 'подборка'}</a>
      {/if}
      {#each t.tags as tag (tag)}<span>#{tag}</span>{/each}
    </div>
  {/if}
{/snippet}

{#snippet row(/** @type {Task} */ t, /** @type {string | null} */ group)}
  {@const subsOpen = t.subtasks.length > 0 && !folded.has(t.id)}
  <li class="task-row" class:is-done={t.status === 'done'} id="task-{t.id}" tabindex={group !== null ? 0 : -1}
    class:dragging={dragRow?.id === t.id} class:drop-before={group !== null && overRow === `${group}:${t.id}`}
    draggable={group !== null}
    ondragstart={(e) => group !== null && ((dragRow = { id: t.id, group }), e.dataTransfer?.setData('text/plain', String(t.id)))}
    ondragend={() => ((dragRow = null), (overRow = null))}
    ondragover={(e) => group !== null && dragOverRow(e, group, t.id)}
    ondrop={(e) => group !== null && (e.preventDefault(), e.stopPropagation(), dropRow(group, t.id))}
    onkeydown={(e) => group !== null && e.target === e.currentTarget && moveByKey(e, t, group)}>
    {#if group !== null}<span class="task-grip" aria-hidden="true" title="Перетащите, чтобы изменить порядок"><Icon name="grip" size={14} /></span>{/if}
    <span class="task-fold">
      {#if t.subtasks.length}
        <button class="icon-btn small-btn" class:open={subsOpen} onclick={() => (folded.has(t.id) ? folded.delete(t.id) : folded.add(t.id))}
          aria-label={subsOpen ? 'Свернуть подзадачи' : 'Показать подзадачи'} aria-expanded={subsOpen}><Icon name="chevron" size={14} /></button>
      {/if}
    </span>
    {@render check(t)}
    <div class="task-body">
      <div class="task-line">
        <button class="task-title" onclick={() => (expanded = t.id)}>{t.title}</button>
        {#if t.status === 'doing'}<span class="status-badge" data-status="voting">в работе</span>{/if}
        <span class="spacer"></span>
        <button class="icon-btn small-btn task-star" class:on={t.important} onclick={() => patchTask(t.id, { important: !t.important })}
          aria-label={t.important ? 'Убрать из важных' : 'Важная'} title={t.important ? 'Убрать из важных' : 'Важная'}><Icon name="star" size={14} /></button>
        {@render due(t)}
      </div>
      {@render meta(t)}
      {#if subsOpen}
        <ul class="task-subs">
          {#each t.subtasks as s (s.id)}
            <li>
              <label class:done={s.done}>
                <input type="checkbox" checked={s.done} onchange={(e) => patchSubtask(t.id, s.id, { done: e.currentTarget.checked })} />{s.title}
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </li>
{/snippet}

<div class="tasks-page">
  <nav class="tasks-nav" aria-label="Разделы задач">
    <button class="link-btn tasks-back" onclick={() => navigate(lastPath().startsWith('/tasks') ? '/0' : lastPath())}><Icon name="back" size={16} />К книге</button>
    {#each SECTIONS as [id, label, icon] (id)}
      <button class="tasks-nav-item" class:active={section === id} onclick={() => ((section = id), (expanded = null))}>
        <Icon name={icon} size={16} /><span>{label}</span>{#if counts[id]}<span class="tasks-count" class:alert={id === 'today'}>{counts[id]}</span>{/if}
      </button>
    {/each}
    <div class="tasks-nav-title">Списки</div>
    {#each tasks.lists as l (l.id)}
      {#if editingList === l.id}
        <form class="tasks-list-form" onsubmit={(e) => (e.preventDefault(), (editingList = null))}>
          <input class="text-input emoji-input" value={l.emoji ?? ''} aria-label="Эмодзи" onchange={(e) => updateList(l.id, { emoji: e.currentTarget.value.trim() || null })} />
          <input class="text-input" value={l.title} aria-label="Название списка" onchange={(e) => e.currentTarget.value.trim() && updateList(l.id, { title: e.currentTarget.value.trim() })} />
          <button type="button" class="icon-btn small-btn" aria-label="Удалить список" title="Удалить список (задачи останутся)"
            onclick={() => deleteList(l.id).then(() => ((editingList = null), section === `list:${l.id}` && (section = 'all')))}><Icon name="trash" /></button>
        </form>
      {:else}
        <button class="tasks-nav-item" class:active={section === `list:${l.id}`} onclick={() => ((section = `list:${l.id}`), (expanded = null))}
          ondblclick={() => (editingList = l.id)} title="Двойной щелчок — изменить">
          <span class="tasks-emoji">{l.emoji ?? '•'}</span><span>{l.title}</span>
          {#if open.filter((t) => t.listId === l.id).length}<span class="tasks-count">{open.filter((t) => t.listId === l.id).length}</span>{/if}
        </button>
      {/if}
    {/each}
    <form class="tasks-list-form" onsubmit={(e) => (e.preventDefault(), addList())}>
      <input class="text-input emoji-input" bind:value={newEmoji} placeholder="📚" aria-label="Эмодзи списка" />
      <input class="text-input" bind:value={newList} placeholder="Новый список" aria-label="Новый список" />
    </form>
  </nav>

  <main class="tasks-main" class:wide={view === 'kanban'}>
    <div class="tasks-inner">
      <h2 class="tasks-h">{sectionTitle} ({active.length})</h2>
      <div class="tasks-toolbar">
        <div class="tasks-views" role="radiogroup" aria-label="Вид">
          <button role="radio" aria-checked={view === 'list'} class:active={view === 'list'} onclick={() => setView('list')}><Icon name="list" size={16} />Список</button>
          <button role="radio" aria-checked={view === 'kanban'} class:active={view === 'kanban'} onclick={() => setView('kanban')}><Icon name="kanban" size={16} />Канбан</button>
        </div>
        <label class="tasks-search">
          <Icon name="search" size={16} />
          <input bind:value={query} placeholder="Поиск" aria-label="Найти задачу" />
        </label>
        <span class="spacer"></span>
        <span class="muted small">{shown.length} {plural(shown.length, 'задача', 'задачи', 'задач')}</span>
      </div>
      {#if refFilter}
        <div class="tasks-filter">
          Задачи абзаца <b>{refFilter}</b>
          <button class="link-btn" onclick={() => navigate(`/${refFilter}`)}>открыть в книге</button>
          <button class="icon-btn small-btn" aria-label="Показать все" onclick={() => navigate('/tasks')}><Icon name="close" /></button>
        </div>
      {/if}

      {#if view === 'list'}
        {#if !active.length}
          <p class="muted tasks-empty">
            {tasks.loaded ? (query || refFilter ? 'Ничего не найдено.' : 'Задач нет. Добавьте первую ниже или из книги: меню «⋮» у абзаца → «Задача».') : 'Загрузка…'}
          </p>
        {/if}
        {#each groups as [key, label, list] (key)}
          <section class="task-group" class:drop-end={overRow === `${key}:end`} class:drop-target={dragRow !== null && dragRow.group !== key && groupDue(key) !== undefined}
            ondragover={(e) => dragOverRow(e, key, 'end')} ondrop={(e) => (e.preventDefault(), dropRow(key, null))}>
            {#if groups.length > 1 || key !== 'none'}
              <div class="task-group-title" class:overdue={key === 'overdue'}>{label} <span class="muted">{list.length}</span></div>
            {/if}
            <ol class="task-list">{#each list as t (t.id)}{@render row(t, key)}{/each}</ol>
          </section>
        {/each}
        {#if adding}
          <form class="task-add-row" onsubmit={(e) => (e.preventDefault(), add())}>
            <span class="task-fold"></span><span class="task-circle"></span>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={newTitle} autofocus aria-label="Новая задача"
              placeholder={refFilter ? `Задача к ${refFilter} — Enter, Esc — отмена` : 'Название — Enter, Esc — отмена'}
              onkeydown={(e) => e.key === 'Escape' && ((adding = false), (newTitle = ''))} onblur={() => !newTitle.trim() && (adding = false)} />
          </form>
        {:else}
          <button class="task-add-btn" onclick={() => (adding = true)}><Icon name="plus" size={16} />Добавить задачу</button>
        {/if}
        {#if done.length}
          <button class="task-done-toggle" class:open={showDone} onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
            <span class="task-fold"><Icon name="chevron" size={14} /></span>Выполненные <span class="muted">{done.length}</span>
          </button>
          {#if showDone}<ol class="task-list">{#each done as t (t.id)}{@render row(t, null)}{/each}</ol>{/if}
        {/if}
      {:else}
        <div class="kanban">
          {#each COLUMNS as [status, label] (status)}
            {@const cards = column(status)}
            <section class="kanban-col" class:over={overCol === status}
              ondragover={(e) => (e.preventDefault(), (overCol = status))} ondragleave={(e) => e.currentTarget === e.target && (overCol = null)}
              ondrop={(e) => (e.preventDefault(), dropTo(status, null))} aria-label={label}>
              <header class="kanban-title"><span>{label}</span><span class="muted">{cards.length}</span></header>
              <div class="kanban-cards">
                {#each cards as t (t.id)}
                  <article class="kanban-card" class:dragging={dragId === t.id} draggable="true"
                    ondragstart={(e) => ((dragId = t.id), e.dataTransfer?.setData('text/plain', String(t.id)))} ondragend={() => (dragId = overCol = null)}
                    ondrop={(e) => (e.preventDefault(), e.stopPropagation(), dropTo(status, t.id))}>
                    <div class="kanban-card-head">
                      <button class="task-title" onclick={() => (expanded = t.id)}>{t.title}</button>
                      {#if t.important}<span class="task-star-mark" title="Важная"><Icon name="star" size={14} /></span>{/if}
                    </div>
                    {#if t.notes}<p class="kanban-notes">{t.notes}</p>{/if}
                    <div class="kanban-foot">
                      {@render meta(t)}
                      {#if t.subtasks.length}<span class="kanban-subs"><Icon name="check-square" size={13} />{t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}</span>{/if}
                    </div>
                    {#if t.due}<div class="kanban-due" class:overdue={t.status !== 'done' && t.due < t0}>Срок: {dueLabel(t.due)}</div>{/if}
                  </article>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {/if}
    </div>
  </main>
</div>

{#if editing}
  <Drawer title="Задача" subtitle={editing.status === 'done' ? 'Выполнена' : ''} onclose={() => (expanded = null)}>
    <TaskEditor task={editing} onclose={() => (expanded = null)} />
  </Drawer>
{/if}
