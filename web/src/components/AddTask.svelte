<script>
  import { createTask, loadTasks } from '../lib/tasks.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * "Задача" on the selection toolbar: a personal task tied to this place in the book.
   * @type {{ link: () => { ref: string, annotationId?: number | null }, suggest: string, ondone?: () => void, label?: boolean }}
   */
  let { link, suggest, ondone, label = true } = $props();

  let open = $state(false);
  let title = $state('');

  function toggle() {
    open = !open;
    if (open) {
      title = suggest;
      void loadTasks();
    }
  }
  async function add() {
    if (!title.trim()) return;
    const t = await createTask({ title: title.trim(), ...link() });
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
      <input class="text-input" bind:value={title} autofocus aria-label="Задача" placeholder="Что сделать (можно с #меткой)" />
      <div class="row-end">
        <button type="button" class="btn" onclick={() => (open = false)}>Отмена</button>
        <button class="btn primary" disabled={!title.trim()}>Добавить</button>
      </div>
    </form>
  {/if}
</span>
