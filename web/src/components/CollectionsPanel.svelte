<script>
  import { api } from '../lib/api.js';
  import { collections, loadCollections, changeCollections, createCollection } from '../lib/collections.svelte.js';
  import { session, can } from '../lib/session.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { copyText, formatTime } from '../lib/notes.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  /** @type {{ visible: boolean, onnavigate?: () => void }} */
  let { visible, onnavigate } = $props();

  let newTitle = $state('');
  /** @type {import('../lib/api.js').Collection[] | null} */
  let shared = $state(null);
  /** @type {import('../lib/api.js').CollectionFull | null} */
  let open = $state(null);
  let error = $state('');

  $effect(() => {
    void session.workspace?.id;
    if (visible) void loadCollections();
  });
  // The open collection follows changes made anywhere.
  $effect(() => {
    const id = collections.openId;
    void collections.version;
    if (!visible || id === null) return;
    api.collection(id).then(
      (c) => ((open = c), (error = '')),
      (err) => ((open = null), (error = err.message)),
    );
  });

  async function create() {
    const title = newTitle.trim();
    if (!title) return;
    const c = await createCollection(title);
    if (c) {
      newTitle = '';
      collections.openId = c.id;
    }
  }

  /** @param {number} id */
  function show(id) {
    error = '';
    open = null;
    collections.openId = id;
  }
  function back() {
    collections.openId = null;
    open = null;
  }

  // ---- The open collection ----
  let editingTitle = $state(false);
  let titleDraft = $state('');
  /** @type {number | null} */ let editingItem = $state(null);
  let itemDraft = $state('');
  let confirmDelete = $state(false);
  /** @type {'heading' | 'text' | null} */ let adding = $state(null);
  let addDraft = $state('');

  /** @param {() => Promise<unknown>} fn */
  const change = (fn) => changeCollections(fn);

  async function saveTitle() {
    editingTitle = false;
    if (open && titleDraft.trim() && titleDraft.trim() !== open.title) {
      const id = open.id;
      await change(() => api.updateCollection(id, { title: titleDraft.trim() }));
    }
  }
  /** @param {Event} e */
  async function saveDescription(e) {
    const v = /** @type {HTMLTextAreaElement} */ (e.currentTarget).value.trim();
    if (open && v !== (open.description ?? '')) {
      const id = open.id;
      await change(() => api.updateCollection(id, { description: v || null }));
    }
  }
  /** @param {import('../lib/api.js').CollectionItem} it */
  function editItem(it) {
    editingItem = it.id;
    itemDraft = it.body ?? '';
  }
  /** @param {import('../lib/api.js').CollectionItem} it */
  async function saveItem(it) {
    if (!open) return;
    const id = open.id;
    const body = itemDraft.trim();
    if (it.kind === 'text' && !body) return;
    if (await change(() => api.editCollectionItem(id, it.id, { body: body || null }))) editingItem = null;
  }
  async function addText() {
    if (!open || !adding || !addDraft.trim()) return;
    const id = open.id;
    const heading = adding === 'heading';
    if (await change(() => api.addCollectionItem(id, { kind: 'text', body: addDraft.trim(), heading }))) {
      adding = null;
      addDraft = '';
    }
  }
  async function remove() {
    if (!open) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    const id = open.id;
    if (await change(() => api.deleteCollection(id))) back();
  }
  async function copyToMine() {
    if (!open) return;
    const id = open.id;
    const c = await change(() => api.copyCollection(id));
    if (c) {
      showToast(`Копия «${c.title}» — в вашем пространстве`);
      collections.openId = c.id;
    }
  }

  // ---- Reordering: drag and drop, or Alt+↑/↓ on a focused item ----
  /** @type {number | null} */ let dragId = $state(null);
  /** @type {number | null} */ let overId = $state(null);
  /** @param {number[]} ids */
  async function reorder(ids) {
    if (!open) return;
    const id = open.id;
    const byId = new Map(open.list.map((x) => [x.id, x]));
    open.list = ids.map((x) => /** @type {import('../lib/api.js').CollectionItem} */ (byId.get(x)));
    await change(() => api.orderCollection(id, ids));
  }
  /** @param {number} target */
  function drop(target) {
    if (!open || dragId === null || dragId === target) return;
    const ids = open.list.map((x) => x.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(target) + (open.list.findIndex((x) => x.id === dragId) < open.list.findIndex((x) => x.id === target) ? 1 : 0), 0, dragId);
    dragId = overId = null;
    void reorder(ids);
  }
  /** @param {KeyboardEvent} e @param {number} id */
  function moveByKey(e, id) {
    if (!open || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const ids = open.list.map((x) => x.id);
    const i = ids.indexOf(id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorder(ids).then(() => document.getElementById(`ci-${id}`)?.focus());
  }

  /** Plain text of paragraph HTML. @param {string} html */
  function plain(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.textContent ?? '';
  }
  /** @param {import('../lib/api.js').CollectionItem} it */
  const refLabel = (it) => (it.refEnd ? `${it.ref}–${it.refEnd.split(':')[1]}` : it.ref);
  /** @param {string} ref */
  function go(ref) {
    navigate(`/${ref}`);
    onnavigate?.();
  }
  function read() {
    if (!open) return;
    navigate(`/c/${open.id}`);
    onnavigate?.();
  }
  const shareLink = () => open && copyText(`${location.origin}/c/${open.id}`);
</script>

{#snippet card(/** @type {import('../lib/api.js').Collection} */ c)}
  <li>
    <button class="result coll-row" onclick={() => show(c.id)}>
      <div class="result-head">
        <b class="ellipsis">{c.title}</b>
        <span class="spacer"></span>
        {#if c.shared}<span class="status-badge" title="Видна всем участникам платформы">общая</span>{/if}
      </div>
      <div class="note-date">
        {c.items} {plural(c.items, 'элемент', 'элемента', 'элементов')} · {formatTime(c.updatedAt)}
        {#if c.workspaceId !== session.workspace?.id} · {c.authorName ?? c.workspaceName}{/if}
      </div>
    </button>
  </li>
{/snippet}

<div class="notes-panel">
  {#if collections.openId === null}
    <div class="panel-head">
      {#if can.edit}
        <form class="notes-filters" onsubmit={(e) => (e.preventDefault(), create())}>
          <input class="text-input" bind:value={newTitle} placeholder="Название новой подборки" aria-label="Название новой подборки" />
          <button class="btn" disabled={!newTitle.trim()}>Создать</button>
        </form>
      {/if}
      <p class="hint">Подборка — абзацы, заметки и ваши заголовки в нужном порядке: план доклада, тема, маршрут чтения. Добавляйте через «⋮» у абзаца или панель выделения.</p>
    </div>
    {#if collections.own.length}
      <div class="box-title">В этом пространстве</div>
      <ol class="results">{#each collections.own as c (c.id)}{@render card(c)}{/each}</ol>
    {:else}
      <p class="muted small">В этом пространстве подборок пока нет.</p>
    {/if}
    {#if collections.subscribed.length}
      <div class="box-title">Подписки</div>
      <ol class="results">{#each collections.subscribed as c (c.id)}{@render card(c)}{/each}</ol>
    {/if}
    {#if shared === null}
      <button class="link-btn" onclick={() => api.sharedCollections().then((l) => (shared = l), (err) => showToast(err.message))}>
        Общие подборки других участников
      </button>
    {:else}
      {@const others = shared.filter((c) => c.workspaceId !== session.workspace?.id && !collections.subscribed.some((s) => s.id === c.id))}
      <div class="box-title">Общие подборки участников</div>
      {#if others.length}<ol class="results">{#each others as c (c.id)}{@render card(c)}{/each}</ol>{:else}<p class="muted small">Других общих подборок нет.</p>{/if}
    {/if}
  {:else}
    <div class="panel-head coll-head">
      <div class="coll-title-row">
        <button class="icon-btn small-btn" onclick={back} aria-label="Все подборки" title="Все подборки"><Icon name="back" /></button>
        {#if open && editingTitle}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="text-input" bind:value={titleDraft} autofocus onblur={saveTitle}
            onkeydown={(e) => (e.key === 'Enter' ? saveTitle() : e.key === 'Escape' && (editingTitle = false))} />
        {:else}
          <h3 class="coll-title" title={open?.canEdit ? 'Нажмите, чтобы переименовать' : ''}>
            {#if open?.canEdit}
              <button class="link-btn coll-title-btn" onclick={() => open && ((titleDraft = open.title), (editingTitle = true))}>{open.title}</button>
            {:else}{open?.title ?? '…'}{/if}
          </h3>
        {/if}
      </div>
      {#if open}
        <div class="note-date">
          {open.list.length} {plural(open.list.length, 'элемент', 'элемента', 'элементов')}
          {#if !open.member} · {open.authorName ?? ''}, «{open.workspaceName}» · только чтение{/if}
        </div>
        <div class="coll-actions">
          <button class="btn primary" onclick={read}><Icon name="book-open" size={16} />Читать</button>
          {#if open.shared || open.member}
            <button class="icon-btn small-btn" onclick={shareLink} title="Скопировать ссылку" aria-label="Скопировать ссылку"><Icon name="link" /></button>
          {/if}
          {#if !open.member && open.shared}
            <button class="btn" class:on={open.subscribed} onclick={() => open && change(() => api.subscribeCollection(open.id, !open.subscribed))}>
              {open.subscribed ? 'Вы подписаны' : 'Подписаться'}
            </button>
          {/if}
          {#if can.edit && (!open.member || open.workspaceId !== session.workspace?.id)}
            <button class="btn" onclick={copyToMine} title="Редактируемая копия в текущем пространстве">Копия к себе</button>
          {/if}
          {#if open.canEdit}
            <span class="spacer"></span>
            <button class="icon-btn small-btn" class:danger={confirmDelete} onblur={() => (confirmDelete = false)} onclick={remove}
              title={confirmDelete ? 'Нажмите ещё раз, чтобы удалить подборку' : 'Удалить подборку'} aria-label="Удалить подборку"><Icon name="trash" /></button>
          {/if}
        </div>
        {#if open.canEdit}
          <label class="toggle small">
            <input type="checkbox" checked={open.shared} onchange={(e) => open && change(() => api.updateCollection(open.id, { shared: e.currentTarget.checked }))} />
            <span>Видна всем участникам платформы (по ссылке, с подпиской и копированием)</span>
          </label>
        {/if}
      {/if}
    </div>
    {#if error}<div class="search-error">{error}</div>{/if}
    {#if open}
      {#if open.canEdit}
        <textarea class="text-area coll-desc" rows="2" placeholder="Описание подборки (необязательно)" value={open.description ?? ''} onchange={saveDescription}></textarea>
      {:else if open.description}
        <p class="coll-desc-text">{open.description}</p>
      {/if}
      {#if !open.list.length}
        <p class="muted small">Пусто. Откройте нужный абзац и выберите «В подборку» в меню «⋮» или на панели выделения.</p>
      {/if}
      <ol class="coll-items">
        {#each open.list as it (it.id)}
          <li id="ci-{it.id}" class="coll-item" class:dragging={dragId === it.id} class:over={overId === it.id && dragId !== it.id}
            class:is-heading={it.kind === 'text' && it.heading} draggable={open.canEdit} tabindex="0"
            ondragstart={(e) => ((dragId = it.id), e.dataTransfer?.setData('text/plain', String(it.id)))}
            ondragover={(e) => (e.preventDefault(), (overId = it.id))} ondragleave={() => overId === it.id && (overId = null)}
            ondrop={(e) => (e.preventDefault(), drop(it.id))} ondragend={() => (dragId = overId = null)}
            onkeydown={(e) => open?.canEdit && moveByKey(e, it.id)}
            aria-label={open.canEdit ? 'Элемент подборки; Alt+↑/↓ — переместить' : undefined}>
            {#if open.canEdit}<span class="coll-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>{/if}
            <div class="coll-item-body">
              {#if it.kind === 'text'}
                {#if editingItem !== it.id}
                  <div class={it.heading ? 'coll-heading' : 'coll-text'}>{it.body}</div>
                {/if}
              {:else if it.kind === 'para'}
                <button class="link-btn coll-ref" onclick={() => it.ref && go(it.ref)}>{refLabel(it)}</button>
                <span class="muted small ellipsis">{it.paragraphs?.[0]?.paperTitle ?? ''}</span>
                <div class="coll-snippet">{plain(it.paragraphs?.[0]?.ru ?? '')}</div>
              {:else if it.note}
                <button class="link-btn coll-ref" onclick={() => it.ref && go(it.ref)}>{it.ref}</button>
                {#if it.note.color}<span class="dot" data-color={it.note.color}></span>{/if}
                {#if it.note.bookmark}<span class="muted small">закладка{it.note.title ? `: ${it.note.title}` : ''}</span>{/if}
                <div class="coll-snippet">{it.note.quote ? `«${it.note.quote}»` : plain(it.paragraphs?.[0]?.ru ?? '')}</div>
                {#if it.note.comments.length}<div class="muted small">{it.note.comments.length} {plural(it.note.comments.length, 'комментарий', 'комментария', 'комментариев')}</div>{/if}
              {:else}
                <div class="muted small">Заметка удалена</div>
              {/if}
              {#if editingItem === it.id}
                <!-- svelte-ignore a11y_autofocus -->
                <textarea class="text-area" rows="3" bind:value={itemDraft} autofocus
                  placeholder={it.kind === 'text' ? 'Текст' : 'Ваш комментарий к элементу'}
                  onkeydown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? saveItem(it) : e.key === 'Escape' && (editingItem = null))}></textarea>
                <div class="row-end">
                  <button class="btn" onclick={() => (editingItem = null)}>Отмена</button>
                  <button class="btn primary" onclick={() => saveItem(it)}>Сохранить</button>
                </div>
              {:else if it.kind !== 'text' && it.body}
                <div class="coll-comment">{it.body}</div>
              {/if}
            </div>
            {#if open.canEdit && editingItem !== it.id}
              <span class="coll-item-actions">
                <button class="icon-btn small-btn" onclick={() => editItem(it)} aria-label={it.kind === 'text' ? 'Изменить' : 'Комментарий'}
                  title={it.kind === 'text' ? 'Изменить' : 'Комментарий к элементу'}><Icon name={it.kind === 'text' ? 'edit' : 'comment'} /></button>
                <button class="icon-btn small-btn" onclick={() => open && change(() => api.deleteCollectionItem(open.id, it.id))}
                  aria-label="Убрать из подборки" title="Убрать из подборки"><Icon name="close" /></button>
              </span>
            {/if}
          </li>
        {/each}
      </ol>
      {#if open.canEdit}
        {#if adding}
          <div class="group coll-add">
            <!-- svelte-ignore a11y_autofocus -->
            <textarea class="text-area" rows={adding === 'heading' ? 1 : 3} bind:value={addDraft} autofocus
              placeholder={adding === 'heading' ? 'Заголовок раздела' : 'Пояснение, переход, вопрос для обсуждения…'}
              onkeydown={(e) => (e.key === 'Enter' && (adding === 'heading' || e.ctrlKey || e.metaKey) ? (e.preventDefault(), addText()) : e.key === 'Escape' && (adding = null))}></textarea>
            <div class="row-end">
              <button class="btn" onclick={() => (adding = null)}>Отмена</button>
              <button class="btn primary" onclick={addText} disabled={!addDraft.trim()}>Добавить</button>
            </div>
          </div>
        {:else}
          <div class="coll-add-row">
            <button class="btn" onclick={() => ((adding = 'heading'), (addDraft = ''))}><Icon name="plus" size={14} />Заголовок</button>
            <button class="btn" onclick={() => ((adding = 'text'), (addDraft = ''))}><Icon name="plus" size={14} />Текст</button>
          </div>
        {/if}
      {/if}
    {/if}
  {/if}
</div>
