<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { tasks, loadTasks, createTask, patchTask, deleteTask, orderTasks, taskTags, tagCounts, nestTask, moveSubtask, unnestSubtask } from '../lib/tasks.svelte.js';
  import { swipeRow } from '../lib/swipe.js';
  import { taskDrag } from '../lib/taskdrag.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { titleTags } from '../../../shared/tasktags.js';
  import { navigate, route, lastPath } from '../lib/router.svelte.js';
  import Icon from './Icon.svelte';
  import { pinchFont } from '../lib/pinch.js';
  import { settings, setSetting } from '../lib/settings.svelte.js';
  import TaskCard from './TaskCard.svelte';

  /** @typedef {import('../lib/api.js').Task} Task */

  onMount(() => {
    void loadTasks(true);
  });

  // ---- Where we are: section (or list), view, search, a paragraph filter from the reader ----
  const VIEW_KEY = 'ub.tasksView';
  let section = $state(/** @type {string} */ ('all'));
  let view = $state(/** @type {'list' | 'kanban'} */ (readView()));
  let query = $state('');
  /** The search field is hidden until its icon is pressed; closing it clears the search. */
  let searching = $state(false);
  function toggleSearch() {
    searching = !searching;
    if (!searching) query = '';
  }
  let refFilter = $state(/** @type {string | null} */ (null));
  let showDone = $state(false);
  /** The star by the search: only the important ones (with a tag chosen, among its tasks). */
  let onlyImportant = $state(false);

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
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }
  // /tasks?ref=5:1.2 — tasks of one paragraph (from the marker in the book's margin).
  $effect(() => {
    void route.nav;
    refFilter = new URLSearchParams(location.search).get('ref');
  });

  /** @param {Task} t */
  function matches(t) {
    if (refFilter && t.ref !== refFilter && !(t.refEnd && t.ref && covers(t, refFilter))) return false;
    const q = query.trim().toLowerCase();
    if (q && ![t.title, t.notes ?? '', taskTags(t).join(' '), t.ref ?? ''].some((s) => s.toLowerCase().includes(q))) return false;
    if (onlyImportant && !t.important) return false;
    if (section.startsWith('tag:')) return taskTags(t).includes(section.slice(4));
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
  const shown = $derived(tasks.items.filter((t) => !leaving.has(t.id) && matches(t)));
  const active = $derived(shown.filter((t) => t.status !== 'done').sort(byOrder));
  const done = $derived(shown.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')));

  /** The list: the open tasks in their manual order (no dates — tasks are sorted by tags). */
  const groups = $derived(/** @type {[string, string, Task[]][]} */ (active.length ? [['all', '', active]] : []));

  // Counters in the navigation.
  const open = $derived(tasks.items.filter((t) => t.status !== 'done'));
  /** A tag's section: "tag:<name>". */
  const sectionTag = $derived(section.startsWith('tag:') ? section.slice(4) : null);
  const sectionTitle = $derived(sectionTag ? `#${sectionTag}` : 'Задачи');
  /**
   * The tags as sections: those with open tasks, most used first (and the open section's tag, even if
   * its tasks are all done).
   */
  const tagSections = $derived(tagCounts().filter((t) => t.count > 0 || t.name === sectionTag));
  /** A tag's tasks; the chosen tag again — all the tasks. @param {string} tag */
  function showTag(tag) {
    section = section === `tag:${tag}` ? 'all' : `tag:${tag}`;
  }

  // ---- Quick add: the new task takes the section's context (in a tag's section — the tag) ----
  let newTitle = $state('');
  /** @param {import('../lib/api.js').TaskStatus} [status] the kanban column it is added in */
  async function add(status = 'todo') {
    const title = newTitle.trim();
    if (!title) return;
    const t = await createTask({
      title,
      tags: sectionTag && !titleTags(title).includes(sectionTag) ? [sectionTag] : [],
      important: onlyImportant,
      ref: refFilter,
    });
    if (t && status !== 'todo') await patchTask(t.id, { status }); // (a new task is created to do)
    if (t) newTitle = '';
  }
  /** Kanban: the column whose "+ Добавить задачу" is open. */
  let addingIn = $state(/** @type {import('../lib/api.js').TaskStatus | null} */ (null));

  // ---- Kanban: its columns (a task dragged to one takes its status) ----
  const COLUMNS = /** @type {const} */ ([['todo', 'Нужно сделать'], ['doing', 'В работе'], ['done', 'Готово']]);
  /** @param {import('../lib/api.js').TaskStatus} s */
  const column = (s) => shown.filter((t) => t.status === s).sort(s === 'done' ? (a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') : byOrder);

  // ---- Dragging (lib/taskdrag.js), in the list and on the kanban alike ----
  // A task onto another's middle — its subtask (with its own subtasks); near its top / bottom — before / after
  // it (on the kanban: in its column); onto a column — there, at its end. A subtask out of its card — a task
  // of its own, there; onto another task — that task's subtask.
  /**
   * The open tasks in order with `id` put before / after `near` (null — at the end): the list's, or a column's.
   * @param {number} id @param {import('../lib/api.js').TaskStatus} status @param {number | null} near @param {'before' | 'after' | 'into'} [zone]
   */
  async function place(id, status, near, zone = 'before') {
    if (status === 'done') return; // (the done ones go by when they were done)
    const ids = (view === 'list' ? active : column(status)).map((x) => x.id).filter((x) => x !== id);
    const i = near === null ? ids.length : ids.indexOf(near);
    ids.splice(i < 0 ? ids.length : zone === 'after' ? i + 1 : i, 0, id);
    await orderTasks(ids);
  }
  /** @param {import('../lib/taskdrag.js').DragWhat} what @param {import('../lib/taskdrag.js').DropAt} at */
  async function dropped(what, at) {
    const target = at.type === 'task' ? tasks.items.find((x) => x.id === at.id) : null;
    const status = /** @type {import('../lib/api.js').TaskStatus} */ (at.type === 'col' ? at.status : (target?.status ?? 'todo'));
    if (what.kind === 'task') {
      if (at.type === 'task' && at.zone === 'into') return nestTask(what.id, at.id);
      const t = tasks.items.find((x) => x.id === what.id);
      if (t && t.status !== status) await patchTask(t.id, { status });
      return place(what.id, status, at.type === 'task' ? at.id : null, at.type === 'task' ? at.zone : 'before');
    }
    if (at.type === 'task' && at.zone === 'into') return moveSubtask(what.parent, what.id, at.id);
    const made = await unnestSubtask(what.parent, what.id, status);
    if (made) await place(made.id, status, at.type === 'task' ? at.id : null, at.type === 'task' ? at.zone : 'before');
  }
  let adding = $state(false);
  /** @param {Task} t */
  const toggleDone = (t) => patchTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' });

  // ---- A row swiped aside (a phone): to the right — done (or back to work), to the left — deleted ----
  // The deleted row goes at once; the task itself a few seconds later, unless «Вернуть» was pressed —
  // nothing has to be made again (its subtasks, its place, its message stay as they were).
  const leaving = new SvelteSet();
  /** @param {Task} t */
  function removeSoon(t) {
    leaving.add(t.id);
    showToast('Задача удалена', { label: 'Вернуть', run: () => leaving.delete(t.id) });
    setTimeout(() => {
      if (!leaving.has(t.id)) return;
      leaving.delete(t.id);
      void deleteTask(t.id);
    }, 6500);
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

{#snippet row(/** @type {Task} */ t, /** @type {string | null} */ group)}
  <!-- (a row is focused on purpose: Alt+arrows move it in the list — a keyboard reorder) -->
  <!-- An open task's row: held and dragged — another place, or into another task; a target for both
       (data-drop: lib/taskdrag.js). A done one: neither. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <li class="task-row" class:is-done={t.status === 'done'} id="task-{t.id}" tabindex={group !== null ? 0 : -1}
    use:swipeRow={{ onright: () => toggleDone(t), onleft: () => removeSoon(t) }}
    data-swipe-right={t.status === 'done' ? 'Вернуть' : 'Готово'}
    data-drop={group !== null ? `task:${t.id}` : undefined}
    use:taskDrag={{ what: { kind: 'task', id: t.id }, ondrop: dropped, enabled: group !== null }}
    onkeydown={(e) => group !== null && e.target === e.currentTarget && moveByKey(e, t, group)}>
    {@render check(t)}
    <div class="task-body">
      <TaskCard task={t} onshowtag={showTag} ondrop={dropped} />
    </div>
    <!-- its number, small and pale at the bottom right (once the server has numbered it) -->
    {#if t.id > 0}<span class="task-num" aria-label="Задача номер {t.id}">#{t.id}</span>{/if}
  </li>
{/snippet}

<div class="tasks-page">
  <nav class="tasks-nav" aria-label="Разделы задач">
    <button class="link-btn tasks-back" onclick={() => navigate(lastPath().startsWith('/tasks') ? '/0' : lastPath(), { root: true })}><Icon name="back" size={16} />К книге</button>
    <!-- (the phone's strip: only the tags — the chosen one again shows all) -->
    <button class="tasks-nav-item tasks-nav-all" class:active={section === 'all'} onclick={() => (section = 'all')}>
      <Icon name="inbox" size={16} /><span>Все задачи</span>{#if open.length}<span class="tasks-count">{open.length}</span>{/if}
    </button>
    <!-- Tags as sections: #words in the titles and the tags of the details -->
    <div class="tasks-nav-title">Метки</div>
    {#each tagSections as tg (tg.name)}
      <button class="tasks-nav-item" class:active={section === `tag:${tg.name}`} onclick={() => showTag(tg.name)}>
        <span class="tasks-hash" aria-hidden="true">#</span><span>{tg.name}</span>{#if tg.count}<span class="tasks-count">{tg.count}</span>{/if}
      </button>
    {:else}
      <p class="tasks-nav-hint muted small">Напишите <b>#метку</b> в названии задачи или добавьте её в деталях — задачи разложатся по меткам.</p>
    {/each}
  </nav>

  <main class="tasks-main" class:wide={view === 'kanban'}>
    <div class="tasks-inner">
      <!-- The section's title; on its right — search (an icon, the field opens under it) and the view (two small icons) -->
      <div class="tasks-head">
        <!-- (open / all): "Задачи (2/13)" -->
        <h2 class="tasks-h" title="Не завершено {active.length} из {shown.length}">{sectionTitle === 'Все задачи' ? 'Задачи' : sectionTitle} ({active.length}/{shown.length})</h2>
        <span class="spacer"></span>
        <button class="icon-btn small-btn tasks-star" class:on={onlyImportant} onclick={() => (onlyImportant = !onlyImportant)} aria-pressed={onlyImportant}
          aria-label="Только важные" title={onlyImportant ? 'Показать все' : 'Только важные'}><Icon name="star" /></button>
        <button class="icon-btn small-btn" class:on={searching} onclick={toggleSearch} aria-expanded={searching}
          aria-label="Поиск" title="Поиск"><Icon name="search" /></button>
        <div class="tasks-views" role="radiogroup" aria-label="Вид">
          <button role="radio" aria-checked={view === 'list'} class:active={view === 'list'} onclick={() => setView('list')}
            aria-label="Список" title="Список"><Icon name="list" size={16} /></button>
          <button role="radio" aria-checked={view === 'kanban'} class:active={view === 'kanban'} onclick={() => setView('kanban')}
            aria-label="Канбан" title="Канбан"><Icon name="kanban" size={16} /></button>
        </div>
      </div>
      {#if searching}
        <label class="tasks-search">
          <Icon name="search" size={16} />
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={query} placeholder="Поиск" aria-label="Найти задачу" autofocus
            onkeydown={(e) => e.key === 'Escape' && toggleSearch()} />
          <button class="icon-btn small-btn" onclick={(e) => (e.preventDefault(), toggleSearch())} aria-label="Закрыть поиск" title="Закрыть поиск"><Icon name="close" size={16} /></button>
        </label>
      {/if}
      {#if refFilter}
        <div class="tasks-filter">
          Задачи абзаца <b>{refFilter}</b>
          <button class="link-btn" onclick={() => navigate(`/${refFilter}`)}>открыть в книге</button>
          <button class="icon-btn small-btn" aria-label="Показать все" onclick={() => navigate('/tasks')}><Icon name="close" /></button>
        </div>
      {/if}

      {#if view === 'list'}
        <!-- two fingers change the list's size, as on the kanban -->
        <div class="task-list-view" use:pinchFont={{ get: () => settings.taskListFontSize, set: (px) => setSetting('taskListFontSize', px), min: 11, max: 22, anchor: '.task-row' }}>
        <!-- a new task goes first: the field is above the list -->
        {#if adding}
          <form class="task-add-row" onsubmit={(e) => (e.preventDefault(), add())}>
            <span class="task-fold"></span><span class="task-circle"></span>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={newTitle} autofocus aria-label="Новая задача"
              placeholder={refFilter ? `Задача к ${refFilter} — Enter, Esc — отмена` : 'Название — Enter, Esc — отмена'}
              onkeydown={(e) => e.key === 'Escape' && ((adding = false), (newTitle = ''))} onblur={() => !newTitle.trim() && (adding = false)} />
            <!-- saved without the keyboard's Enter -->
            <button class="ui-round primary task-add-ok" disabled={!newTitle.trim()} aria-label="Сохранить задачу" title="Сохранить"><Icon name="check" size={18} /></button>
          </form>
        {:else}
          <button class="task-add-btn" onclick={() => (adding = true)}><Icon name="plus" size={16} />Добавить задачу</button>
        {/if}
        {#if !active.length}
          <p class="muted tasks-empty">
            {tasks.loaded ? (query || refFilter || onlyImportant ? 'Ничего не найдено.' : 'Задач нет. Добавьте первую выше или из книги: меню «⋮» у абзаца → «Задача».') : 'Загрузка…'}
          </p>
        {/if}
        {#each groups as [key, , list] (key)}
          <section class="task-group" role="group" aria-label="Задачи">
            <ol class="task-list">{#each list as t (t.id)}{@render row(t, key)}{/each}</ol>
          </section>
        {/each}
        {#if done.length}
          <button class="task-done-toggle" class:open={showDone} onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
            <span class="task-fold"><Icon name="chevron" size={14} /></span>Выполненные <span class="muted">{done.length}</span>
          </button>
          {#if showDone}<ol class="task-list">{#each done as t (t.id)}{@render row(t, null)}{/each}</ol>{/if}
        {/if}
        </div>
      {:else}
        <!-- two fingers change the cards' size: smaller — more tasks in a column on one screen -->
        <div class="kanban" use:pinchFont={{ get: () => settings.kanbanFontSize, set: (px) => setSetting('kanbanFontSize', px), min: 10, max: 20, anchor: '.kanban-card' }}>
          {#each COLUMNS as [status, label] (status)}
            {@const cards = column(status)}
            <!-- (a task dropped onto a column — there, at its end: data-drop, lib/taskdrag.js) -->
            <section class="kanban-col" data-drop="col:{status}" aria-label={label}>
              <header class="kanban-title"><span>{label}</span><span class="muted">{cards.length}</span></header>
              <div class="kanban-cards">
                <!-- a new task goes first: the field is above the cards, as in the list -->
                {#if status !== 'done'}
                  {#if addingIn === status}
                    <!-- the app's add field: a pill with the round button that adds -->
                    <form class="ui-search ui-add kanban-add-form" onsubmit={(e) => (e.preventDefault(), add(status))}
                      onfocusout={(e) => !newTitle.trim() && !e.currentTarget.contains(/** @type {Node | null} */ (e.relatedTarget)) && (addingIn = null)}>
                      <Icon name="check-square" size={18} />
                      <!-- svelte-ignore a11y_autofocus -->
                      <input bind:value={newTitle} autofocus aria-label="Новая задача в колонке «{label}»" placeholder="Новая задача"
                        onkeydown={(e) => e.key === 'Escape' && ((addingIn = null), (newTitle = ''))} />
                      <button class="ui-round primary" disabled={!newTitle.trim()} aria-label="Добавить задачу" title="Добавить"><Icon name="plus" size={18} /></button>
                    </form>
                  {:else}
                    <button class="kanban-add" onclick={() => ((addingIn = status), (newTitle = ''))}><Icon name="plus" size={16} />Добавить задачу</button>
                  {/if}
                {/if}
                {#each cards as t (t.id)}
                  <!-- the same card as in the list: held and dragged, swiped left — deleted -->
                  <article class="kanban-card" data-drop="task:{t.id}"
                    use:taskDrag={{ what: { kind: 'task', id: t.id }, ondrop: dropped }}
                    use:swipeRow={{ onleft: () => removeSoon(t) }}>
                    <TaskCard task={t} onshowtag={showTag} ondrop={dropped} />
                    {#if t.id > 0}<span class="task-num kanban-num" aria-label="Задача номер {t.id}">#{t.id}</span>{/if}
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
