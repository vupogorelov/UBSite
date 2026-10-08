<script>
  import { createTask, tasks, loadTasks, today } from '../lib/tasks.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * "Задача" on the selection toolbar: a personal task tied to this place in the book.
   * @type {{ link: () => { ref: string, annotationId?: number | null }, suggest: string, ondone?: () => void, label?: boolean }}
   */
  let { link, suggest, ondone, label = true } = $props();

  let open = $state(false);
  let title = $state('');
  let due = $state('');
  let listId = $state('');

  function toggle() {
    open = !open;
    if (open) {
      title = suggest;
      due = '';
      void loadTasks();
    }
  }
  async function add() {
    if (!title.trim()) return;
    const t = await createTask({ title: title.trim(), due: due || null, listId: listId ? Number(listId) : null, ...link() });
    if (t) {
      open = false;
      showToast('Задача добавлена — она в «Моих задачах»');
      ondone?.();
    }
  }
</script>

<span class="add-coll add-task">
  <button class="tb-btn" class:on={open} onclick={toggle} title="Задача к этому месту" aria-haspopup="dialog" aria-expanded={open}>
    <Icon name="check-square" size={16} />{#if label}<span>Задача</span>{/if}
  </button>
  {#if open}
    <form class="menu add-task-menu" onsubmit={(e) => (e.preventDefault(), add())}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="text-input" bind:value={title} autofocus aria-label="Задача" placeholder="Что сделать" />
      <div class="add-task-row">
        <input type="date" class="text-input" bind:value={due} aria-label="Срок" min={today()} />
        {#if tasks.lists.length}
          <select class="text-input" bind:value={listId} aria-label="Список">
            <option value="">Без списка</option>
            {#each tasks.lists as l (l.id)}<option value={String(l.id)}>{l.emoji ? `${l.emoji} ` : ''}{l.title}</option>{/each}
          </select>
        {/if}
      </div>
      <div class="row-end">
        <button type="button" class="btn" onclick={() => (open = false)}>Отмена</button>
        <button class="btn primary" disabled={!title.trim()}>Добавить</button>
      </div>
    </form>
  {/if}
</span>
