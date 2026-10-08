<script>
  import { collections, loadCollections, addToCollection } from '../lib/collections.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * "В подборку": a menu of the workspace's collections (the last used first) and a new one.
   * @type {{ item: () => import('../lib/api.js').NewCollectionItem, ondone?: () => void, label?: boolean }}
   */
  let { item, ondone, label = true } = $props();

  let open = $state(false);
  let title = $state('');

  const list = $derived(
    [...collections.own].sort((a, b) => (b.id === collections.lastId ? 1 : 0) - (a.id === collections.lastId ? 1 : 0)),
  );

  function toggle() {
    open = !open;
    if (open) void loadCollections();
  }
  /** @param {number | null} id */
  async function add(id) {
    if (await addToCollection(id, item(), title.trim())) {
      open = false;
      title = '';
      ondone?.();
    }
  }
</script>

<span class="add-coll add-collection">
  <button class="tb-btn" class:on={open} onclick={toggle} title="Добавить в подборку" aria-haspopup="menu" aria-expanded={open}>
    <Icon name="layers" size={16} />{#if label}<span>В подборку</span>{/if}
  </button>
  {#if open}
    <div class="menu add-coll-menu" role="menu">
      {#each list as c (c.id)}
        <button role="menuitem" onclick={() => add(c.id)}>
          <span class="ellipsis">{c.title}</span><span class="muted small">{c.items}</span>
        </button>
      {/each}
      <form class="add-coll-new" onsubmit={(e) => (e.preventDefault(), add(null))}>
        <input class="text-input" bind:value={title} placeholder="Новая подборка…" aria-label="Название новой подборки" />
        <button class="icon-btn small-btn" disabled={!title.trim()} aria-label="Создать и добавить" title="Создать и добавить"><Icon name="plus" /></button>
      </form>
    </div>
  {/if}
</span>
