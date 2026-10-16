<script>
  import { patchTask, taskTags, tagCounts, setTaskTags, deleteTask, addSubtask, patchSubtask, deleteSubtask, placeLabel, openTaskMessage } from '../lib/tasks.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import Icon from './Icon.svelte';
  import TagInput from './TagInput.svelte';
  import { titleTags } from '../../../shared/tasktags.js';

  /** Full editing of one task. @type {{ task: import('../lib/api.js').Task, onclose?: () => void }} */
  let { task, onclose } = $props();

  let newSub = $state('');
  let confirmDelete = $state(false);
  let placeError = $state('');

  /** @param {import('../lib/api.js').TaskPatch} patch */
  const save = (patch) => patchTask(task.id, patch);
  /** @param {Event} e */
  const value = (e) => /** @type {HTMLInputElement} */ (e.currentTarget).value;

  /** "5:1.2", "5:1.2–1.4" or "5:1.2-5:1.4" → ref and refEnd. @param {string} s */
  async function savePlace(s) {
    placeError = '';
    const v = s.trim().replace(/\s+/g, '');
    if (!v) return save({ ref: null, refEnd: null });
    const m = v.match(/^(\d+):(\d+)\.(\d+)(?:[-–—](?:(\d+):)?(?:(\d+)\.)?(\d+))?$/);
    if (!m) {
      placeError = 'Формат: 5:1.2 или 5:1.2–1.4';
      return;
    }
    const ref = `${m[1]}:${m[2]}.${m[3]}`;
    const refEnd = m[6] ? `${m[4] ?? m[1]}:${m[5] ?? m[2]}.${m[6]}` : null;
    if (!(await save({ ref, refEnd }))) placeError = 'Нет такого абзаца';
  }
  async function addSub() {
    if (newSub.trim() && (await addSubtask(task.id, newSub.trim()))) newSub = '';
  }
  async function remove() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    await deleteTask(task.id);
    onclose?.();
  }
  const STATUS = /** @type {const} */ ([['todo', 'Нужно сделать'], ['doing', 'В работе'], ['done', 'Готово']]);
</script>

<div class="task-editor">
  <input class="text-input task-editor-title" value={task.title} aria-label="Задача"
    onchange={(e) => value(e).trim() && save({ title: value(e).trim() })} />
  <!-- All the task's tags: the title's #words and the added ones; a removed #word leaves the title too -->
  <div class="task-tags">
    <TagInput value={taskTags(task)} fromTitle={titleTags(task.title)} source={tagCounts()} placeholder="Добавить метку"
      onchange={(names) => setTaskTags(task, names)} />
  </div>
  <textarea class="text-area" rows="3" placeholder="Описание, мысли, план…" value={task.notes ?? ''}
    onchange={(e) => save({ notes: value(e).trim() || null })}></textarea>

  <div class="task-fields">
    <label>
      <span>Место в книге</span>
      <span class="task-place-input">
        <input class="text-input" value={placeLabel(task)} placeholder="5:1.2 или 5:1.2–1.4" onchange={(e) => savePlace(value(e))} />
        {#if task.ref}
          <button class="icon-btn small-btn" title="Открыть в книге" aria-label="Открыть в книге" onclick={() => task.ref && navigate(`/${task.ref}`)}><Icon name="book-open" /></button>
        {/if}
      </span>
      {#if placeError}<span class="field-error">{placeError}</span>{/if}
    </label>
    {#if task.messageChat}
      <div class="task-from-msg">
        <span>Из сообщения</span>
        <button class="link-btn" onclick={() => openTaskMessage(task)}><Icon name="discuss" size={14} />{task.messageChatTitle ?? 'сообщение'}</button>
      </div>
    {/if}
  </div>

  <div class="ui-label">Статус</div>
  <div class="ui-chips" role="radiogroup" aria-label="Статус">
    {#each STATUS as [v, label] (v)}
      <button class="ui-chip" role="radio" aria-checked={task.status === v} class:on={task.status === v} onclick={() => save({ status: v })}>{label}</button>
    {/each}
  </div>

  <label class="ui-option ui-switch-row">
    <span><b>Важная</b><span class="muted small">Красный кружок в списке; фильтр «звёздочка»</span></span>
    <input type="checkbox" class="ui-switch" checked={task.important} onchange={(e) => save({ important: e.currentTarget.checked })} />
  </label>

  <div class="subtasks">
    {#each task.subtasks as s (s.id)}
      <div class="subtask">
        <input type="checkbox" checked={s.done} aria-label="Готово" onchange={(e) => patchSubtask(task.id, s.id, { done: e.currentTarget.checked })} />
        <input class="subtask-title" class:done={s.done} value={s.title} aria-label="Подзадача"
          onchange={(e) => value(e).trim() && patchSubtask(task.id, s.id, { title: value(e).trim() })} />
        <button class="icon-btn small-btn" aria-label="Удалить подзадачу" onclick={() => deleteSubtask(task.id, s.id)}><Icon name="close" /></button>
      </div>
    {/each}
    <form class="subtask" onsubmit={(e) => (e.preventDefault(), addSub())}>
      <Icon name="plus" size={14} />
      <input class="subtask-title" bind:value={newSub} placeholder="Добавить подзадачу" aria-label="Новая подзадача" />
    </form>
  </div>

  <div class="task-editor-actions">
    <button class="ui-btn" class:danger-text={confirmDelete} onblur={() => (confirmDelete = false)} onclick={remove}>
      <Icon name="trash" size={18} />{confirmDelete ? 'Точно удалить?' : 'Удалить'}
    </button>
    {#if onclose}<button class="ui-btn primary" onclick={onclose}>Готово</button>{/if}
  </div>
</div>
