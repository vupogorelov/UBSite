<script>
  import { tick } from 'svelte';
  import { patchTask, patchSubtask, deleteSubtask, placeLabel, openTaskMessage, taskTags, tagCounts, setTaskTags, taskText } from '../lib/tasks.svelte.js';
  import { titleTags, titleParts } from '../../../shared/tasktags.js';
  import { navigate } from '../lib/router.svelte.js';
  import { copyText } from '../lib/notes.svelte.js';
  import { taskDrag } from '../lib/taskdrag.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';

  /**
   * A task's card, the same in the list and on the kanban — everything about it is here (it opens nowhere):
   * its title written in place (a tap), the star, ⧉ copying it, its tags (# — added or taken away), its
   * subtasks (ticked, deleted, dragged out to be tasks of their own; a task dropped onto another becomes its
   * subtask — TasksPage). `ondrop`: where a subtask dragged out of it went.
   * @type {{ task: import('../lib/api.js').Task, onshowtag: (tag: string) => void, ondrop: (what: import('../lib/taskdrag.js').DragWhat, at: import('../lib/taskdrag.js').DropAt) => void }}
   */
  let { task: t, onshowtag, ondrop } = $props();

  /** The chat's marks as tags: drawn in the marks' colors. */
  const MARKS = ['take', 'work', 'done'];

  // ---- The title, written in place ----
  let editing = $state(false);
  /** @type {HTMLTextAreaElement | undefined} */ let field = $state();
  async function edit() {
    editing = true;
    await tick();
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
  function save() {
    const v = (field?.value ?? '').replace(/\s*\n\s*/g, ' ').trim();
    editing = false;
    if (v && v !== t.title) void patchTask(t.id, { title: v });
  }
  /** The field grows with its text. @param {HTMLTextAreaElement} el */
  function grow(el) {
    const fit = () => ((el.style.height = 'auto'), (el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`));
    fit();
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }

  // ---- Tags: those of the title are in it; the added ones under it; # — all of them, to add or take away ----
  let tagging = $state(false);
  const added = $derived(t.tags.filter((x) => !titleTags(t.title).includes(x)));

  // ---- Subtasks ----
  let folded = $state(false);
  const doneSubs = $derived(t.subtasks.filter((s) => s.done).length);
</script>

<div class="task-line">
  {#if editing}
    <!-- (Enter saves, Esc leaves it as it was) -->
    <!-- (cols 1: no width of its own — it takes the title's place, not its 20 characters' width) -->
    <textarea bind:this={field} class="task-title-edit" rows="1" cols="1" value={t.title} use:grow aria-label="Название задачи"
      onkeydown={(e) => (e.key === 'Enter' ? (e.preventDefault(), save()) : e.key === 'Escape' && (editing = false))} onblur={save}></textarea>
  {:else}
    <!-- the title with its #tags drawn in place: a tag — its tasks, the rest — written anew -->
    <button class="task-title" onclick={edit} title="Изменить название">
      {#each titleParts(t.title) as p, i (i)}
        {#if p.tag}
          {@const tag = p.tag}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <span class="task-tag" data-mark={MARKS.includes(tag) ? tag : undefined} title="Задачи с меткой #{tag}" onclick={(e) => (e.stopPropagation(), onshowtag(tag))}>{p.text}</span>
        {:else}{p.text}{/if}
      {/each}
    </button>
  {/if}
  {#if t.status === 'doing' && !editing}<span class="status-badge" data-status="voting">в работе</span>{/if}
  <!-- (written: the field itself takes the room) -->
  {#if !editing}<span class="spacer"></span>{/if}
  <button class="icon-btn small-btn task-star" class:on={t.important} onclick={() => patchTask(t.id, { important: !t.important })}
    aria-pressed={t.important} aria-label={t.important ? 'Убрать из важных' : 'Важная'} title={t.important ? 'Убрать из важных' : 'Важная'}><Icon name="star" size={14} /></button>
  <!-- ⧉ at the card's top right: the task's text copied -->
  <button class="icon-btn small-btn task-copy-row" onclick={() => copyText(taskText(t))} aria-label="Копировать текст задачи" title="Копировать текст задачи"><Icon name="copy" size={14} /></button>
</div>

<div class="task-meta">
  {#if t.messageChat}
    <a class="task-place" href="/chat?c={encodeURIComponent(t.messageChat)}" onclick={(e) => (e.preventDefault(), openTaskMessage(t))}
      title="Открыть сообщение, из которого сделана задача"><Icon name="discuss" size={12} />{t.messageChatTitle ?? 'сообщение'}</a>
  {/if}
  {#if t.ref}
    <a class="task-place" href="/{t.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${t.ref}`))} title={t.paperTitle ?? 'Открыть в книге'}>
      <Icon name="book-open" size={12} />{placeLabel(t)}
    </a>
  {/if}
  {#if t.collectionId}
    <a class="task-place" href="/c/{t.collectionId}" onclick={(e) => (e.preventDefault(), navigate(`/c/${t.collectionId}`))}><Icon name="layers" size={12} />{t.collectionTitle ?? 'подборка'}</a>
  {/if}
  {#if !tagging}
    {#each added as tag (tag)}<button class="task-tag" data-mark={MARKS.includes(tag) ? tag : undefined} onclick={() => onshowtag(tag)} title="Задачи с меткой #{tag}">#{tag}</button>{/each}
  {/if}
  <button class="task-tags-btn" class:on={tagging} onclick={() => (tagging = !tagging)} aria-expanded={tagging}
    aria-label={tagging ? 'Готово с метками' : 'Метки задачи'} title="Метки">#</button>
  {#if t.subtasks.length}
    <button class="task-subs-btn" onclick={() => (folded = !folded)} aria-expanded={!folded} title={folded ? 'Показать подзадачи' : 'Свернуть подзадачи'}>
      <Icon name="check-square" size={12} />{doneSubs}/{t.subtasks.length}<span class="task-subs-chev" class:open={!folded}><Icon name="chevron" size={12} /></span>
    </button>
  {/if}
</div>
{#if tagging}
  <!-- all the task's tags: the title's #words and the added ones; a removed #word leaves the title too -->
  <div class="task-tags-edit no-drag">
    <TagInput value={taskTags(t)} fromTitle={titleTags(t.title)} source={tagCounts()} placeholder="Добавить метку" autofocus
      onchange={(names) => setTaskTags(t, names)} />
  </div>
{/if}

{#if t.subtasks.length && !folded}
  <ul class="task-subs">
    {#each t.subtasks as s (s.id)}
      <!-- (held and dragged out of the card — a task of its own; onto another task — its subtask) -->
      <li class="task-sub" use:taskDrag={{ what: { kind: 'sub', id: s.id, parent: t.id }, ondrop }}>
        <label class:done={s.done}>
          <input type="checkbox" checked={s.done} onchange={(e) => patchSubtask(t.id, s.id, { done: e.currentTarget.checked })} />{s.title}
        </label>
        <button class="icon-btn small-btn task-sub-x" onclick={() => deleteSubtask(t.id, s.id)} aria-label="Удалить подзадачу «{s.title}»" title="Удалить подзадачу"><Icon name="close" size={12} /></button>
      </li>
    {/each}
  </ul>
{/if}
