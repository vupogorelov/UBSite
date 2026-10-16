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
  let shared = $state(/** @type {import('../lib/api.js').Collection[] | null} */ (null));
  let open = $state(/** @type {import('../lib/api.js').CollectionFull | null} */ (null));
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
  let editingItem = $state(/** @type {number | null} */ (null));
  let itemDraft = $state('');
  let confirmDelete = $state(false);
  let adding = $state(/** @type {'heading' | 'text' | null} */ (null));
  let addDraft = $state('');

  /** @param {() => Promise<unknown>} fn */
  /** @template T @param {() => Promise<T>} fn */
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
  let dragId = $state(/** @type {number | null} */ (null));
  let overId = $state(/** @type {number | null} */ (null));
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
    <button class="ui-card ui-card-btn" onclick={() => show(c.id)}>
      <span class="ui-tile"><Icon name="layers" size={18} /></span>
      <span class="ui-card-body">
        <span class="ui-card-title">{c.title}</span>
        <span class="ui-card-meta">{c.items} {plural(c.items, 'элемент', 'элемента', 'элементов')}{#if c.workspaceId !== session.workspace?.id} · {c.authorName ?? c.workspaceName}{/if}</span>
        <span class="ui-card-foot">
          <span>{formatTime(c.updatedAt)}</span>
          {#if c.shared}<span class="ui-chip small ui-card-end" title="Видна всем участникам платформы"><Icon name="globe" size={12} />общая</span>{/if}
        </span>
      </span>
    </button>
  </li>
{/snippet}

<div class="notes-panel">
  {#if collections.openId === null}
    <div class="panel-head">
      {#if can.edit}
        <!-- a new collection: a pill field with its round button -->
        <form class="ui-search ui-add" onsubmit={(e) => (e.preventDefault(), create())}>
          <Icon name="layers" size={18} />
          <input bind:value={newTitle} placeholder="Новая подборка" aria-label="Название новой подборки" />
          <button class="ui-round primary" disabled={!newTitle.trim()} aria-label="Создать подборку" title="Создать"><Icon name="plus" size={18} /></button>
        </form>
      {/if}
      <p class="ui-hint">Абзацы, заметки и ваши заголовки в нужном порядке: план доклада, тема, маршрут чтения. Добавляйте через «⋮» у абзаца или панель выделения.</p>
    </div>
    {#if collections.own.length}
      <div class="ui-label">В этом пространстве</div>
      <ol class="ui-cards">{#each collections.own as c (c.id)}{@render card(c)}{/each}</ol>
    {:else}
      <div class="ui-empty">
        <span class="ui-tile big"><Icon name="layers" size={22} /></span>
        <b>Подборок пока нет</b>
        <p class="muted small">Соберите абзацы и заметки в свою последовательность — для доклада, темы или чтения.</p>
      </div>
    {/if}
    {#if collections.subscribed.length}
      <div class="ui-label">Подписки</div>
      <ol class="ui-cards">{#each collections.subscribed as c (c.id)}{@render card(c)}{/each}</ol>
    {/if}
    {#if shared === null}
      <button class="ui-btn ui-btn-more" onclick={() => api.sharedCollections().then((l) => (shared = l), (err) => showToast(err.message))}>
        <Icon name="globe" size={18} />Общие подборки участников
      </button>
    {:else}
      {@const others = shared.filter((c) => c.workspaceId !== session.workspace?.id && !collections.subscribed.some((s) => s.id === c.id))}
      <div class="ui-label">Общие подборки участников</div>
      {#if others.length}<ol class="ui-cards">{#each others as c (c.id)}{@render card(c)}{/each}</ol>{:else}<p class="ui-hint">Других общих подборок нет.</p>{/if}
    {/if}
  {:else}
    <div class="panel-head coll-head">
      <div class="coll-title-row">
        <button class="ui-round plain" onclick={back} aria-label="Все подборки" title="Все подборки"><Icon name="back" /></button>
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
        <div class="coll-meta">
          {open.list.length} {plural(open.list.length, 'элемент', 'элемента', 'элементов')}
          {#if !open.member} · {open.authorName ?? ''}, «{open.workspaceName}» · только чтение{/if}
          {#if open.shared} · <Icon name="globe" size={12} /> общая{/if}
        </div>
        <!-- the main action, then the round ones -->
        <div class="coll-actions">
          <button class="ui-btn primary coll-read" onclick={read}><Icon name="book-open" size={18} />Читать</button>
          {#if open.shared || open.member}
            <button class="ui-round" onclick={shareLink} title="Скопировать ссылку" aria-label="Скопировать ссылку"><Icon name="link" size={18} /></button>
          {/if}
          {#if open.canEdit}
            <button class="ui-round" class:danger={confirmDelete} onblur={() => (confirmDelete = false)} onclick={remove}
              title={confirmDelete ? 'Нажмите ещё раз, чтобы удалить подборку' : 'Удалить подборку'} aria-label="Удалить подборку"><Icon name="trash" size={18} /></button>
          {/if}
        </div>
        {#if (!open.member && open.shared) || (can.edit && (!open.member || open.workspaceId !== session.workspace?.id))}
          <div class="ui-chips">
            {#if !open.member && open.shared}
              <button class="ui-chip" class:on={open.subscribed} onclick={() => { const o = open; if (o) change(() => api.subscribeCollection(o.id, !o.subscribed)); }}>
                {open.subscribed ? 'Вы подписаны' : 'Подписаться'}
              </button>
            {/if}
            {#if can.edit && (!open.member || open.workspaceId !== session.workspace?.id)}
              <button class="ui-chip" onclick={copyToMine} title="Редактируемая копия в текущем пространстве">Копия к себе</button>
            {/if}
          </div>
        {/if}
        {#if confirmDelete}<p class="ui-hint coll-danger">Нажмите корзину ещё раз — подборка будет удалена.</p>{/if}
        {#if open.canEdit}
          <div class="ui-options">
            <label class="ui-option ui-switch-row">
              <span><b>Общая</b><span class="muted small">Видна всем участникам: по ссылке, с подпиской и копированием</span></span>
              <input type="checkbox" class="ui-switch" checked={open.shared} onchange={(e) => { const o = open, on = e.currentTarget.checked; if (o) change(() => api.updateCollection(o.id, { shared: on })); }} />
            </label>
            <label class="ui-option ui-switch-row">
              <span><b>Только фрагменты</b><span class="muted small">Скрыть исходные абзацы; абзацы без выделения видны целиком</span></span>
              <input type="checkbox" class="ui-switch" checked={open.fragmentsOnly} onchange={(e) => { const o = open, on = e.currentTarget.checked; if (o) change(() => api.updateCollection(o.id, { fragmentsOnly: on })); }} />
            </label>
          </div>
        {/if}
      {/if}
    </div>
    {#if error}<div class="search-error">{error}</div>{/if}
    {#if open}
      {#if open.canEdit}
        <textarea class="text-area coll-desc ui-field" rows="2" placeholder="Описание подборки (необязательно)" value={open.description ?? ''} onchange={saveDescription}></textarea>
      {:else if open.description}
        <p class="coll-desc-text">{open.description}</p>
      {/if}
      {#if !open.list.length}
        <div class="ui-empty">
          <span class="ui-tile big"><Icon name="layers" size={22} /></span>
          <b>Подборка пуста</b>
          <p class="muted small">Откройте нужный абзац и выберите «В подборку» в меню «⋮» или на панели выделения.</p>
        </div>
      {/if}
      <ol class="coll-items">
        {#each open.list as it (it.id)}
          <!-- (a row is focused on purpose: Alt+arrows move it in the list — a keyboard reorder) -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <li id="ci-{it.id}" class="coll-item" class:dragging={dragId === it.id} class:over={overId === it.id && dragId !== it.id}
            class:is-heading={it.kind === 'text' && it.heading} draggable={open.canEdit} tabindex="0"
            ondragstart={(e) => ((dragId = it.id), e.dataTransfer?.setData('text/plain', String(it.id)))}
            ondragover={(e) => (e.preventDefault(), (overId = it.id))} ondragleave={() => overId === it.id && (overId = null)}
            ondrop={(e) => (e.preventDefault(), drop(it.id))} ondragend={() => (dragId = overId = null)}
            onkeydown={(e) => open?.canEdit && moveByKey(e, it.id)}
            aria-label={open.canEdit ? 'Элемент подборки; Alt+↑/↓ — переместить' : undefined}>
            {#if open.canEdit}<span class="coll-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>{/if}
            {#if !(it.kind === 'text' && it.heading)}
              <span class="ui-tile coll-tile" data-color={it.note?.color ?? null}><Icon name={it.kind === 'text' ? 'edit' : it.kind === 'message' ? 'discuss' : it.kind === 'para' ? 'book-open' : it.note?.bookmark ? 'bookmark' : 'comment'} size={16} /></span>
            {/if}
            <div class="coll-item-body">
              {#if it.kind === 'text'}
                {#if editingItem !== it.id}
                  <div class={it.heading ? 'coll-heading' : 'coll-text'}>{it.body}</div>
                {/if}
              {:else if it.kind === 'para'}
                <button class="link-btn coll-ref" onclick={() => it.ref && go(it.ref)}>{refLabel(it)}</button>
                <span class="muted small ellipsis">{it.paragraphs?.[0]?.paperTitle ?? ''}</span>
                <div class="coll-snippet">{it.fragment ? `«${it.fragment.quote}»` : plain(it.paragraphs?.[0]?.ru ?? '')}</div>
              {:else if it.kind === 'message' && it.message}
                <span class="coll-msg-head"><Icon name="discuss" size={13} /><b>{it.message.authorName ?? 'Участник'}</b></span>
                {#if it.ref}<button class="link-btn coll-ref" onclick={() => it.ref && go(it.ref)}>{it.ref}</button>{/if}
                <div class="coll-snippet">«{it.message.text}»</div>
              {:else if it.note}
                <button class="link-btn coll-ref" onclick={() => it.ref && go(it.ref)}>{it.ref}</button>
                {#if it.note.color}<span class="dot" data-color={it.note.color}></span>{/if}
                {#if it.note.bookmark}<span class="muted small">закладка{it.note.title ? `: ${it.note.title}` : ''}</span>{/if}
                <div class="coll-snippet">{it.note.quote ? `«${it.note.quote}»` : plain(it.paragraphs?.[0]?.ru ?? '')}</div>
                {#if it.note.comments.length}<div class="muted small">{it.note.comments.length} {plural(it.note.comments.length, 'комментарий', 'комментария', 'комментариев')}</div>{/if}
              {:else}
                <div class="muted small">Заметка удалена</div>
              {/if}
              {#if it.fragment && (open.fragmentsOnly || it.collapsed)}<div class="muted small">абзац свёрнут — видна только цитата</div>{/if}
              {#if editingItem === it.id}
                <!-- svelte-ignore a11y_autofocus -->
                <textarea class="text-area" rows="3" bind:value={itemDraft} autofocus
                  placeholder={it.kind === 'text' ? 'Текст' : it.fragment ? 'Пояснение к фрагменту' : 'Ваш комментарий к элементу'}
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
                {#if it.fragment}
                  {@const fold = open.fragmentsOnly ? 'Все абзацы скрыты настройкой «Только фрагменты»'
                    : it.collapsed ? 'Показывать абзац целиком' : 'Свернуть абзац: оставить только цитату'}
                  <button class="ui-round small" class:on={it.collapsed || open.fragmentsOnly} disabled={open.fragmentsOnly}
                    onclick={() => { const o = open; if (o) change(() => api.editCollectionItem(o.id, it.id, { collapsed: !it.collapsed })); }}
                    aria-label={fold} title={fold} aria-pressed={it.collapsed}><Icon name={it.collapsed || open.fragmentsOnly ? 'eye-off' : 'eye'} /></button>
                {/if}
                <button class="ui-round small" onclick={() => editItem(it)} aria-label={it.kind === 'text' ? 'Изменить' : it.fragment ? 'Пояснение' : 'Комментарий'}
                  title={it.kind === 'text' ? 'Изменить' : it.fragment ? 'Пояснение к фрагменту' : 'Комментарий к элементу'}><Icon name={it.kind === 'text' ? 'edit' : 'comment'} /></button>
                <button class="ui-round small" onclick={() => { const o = open; if (o) change(() => api.deleteCollectionItem(o.id, it.id)); }}
                  aria-label="Убрать из подборки" title="Убрать из подборки"><Icon name="close" /></button>
              </span>
            {/if}
          </li>
        {/each}
      </ol>
      {#if open.canEdit}
        {#if adding}
          <div class="coll-add">
            <!-- svelte-ignore a11y_autofocus -->
            <textarea class="text-area ui-field" rows={adding === 'heading' ? 1 : 3} bind:value={addDraft} autofocus
              placeholder={adding === 'heading' ? 'Заголовок раздела' : 'Пояснение, переход, вопрос для обсуждения…'}
              onkeydown={(e) => (e.key === 'Enter' && (adding === 'heading' || e.ctrlKey || e.metaKey) ? (e.preventDefault(), addText()) : e.key === 'Escape' && (adding = null))}></textarea>
            <div class="row-end">
              <button class="btn" onclick={() => (adding = null)}>Отмена</button>
              <button class="btn primary" onclick={addText} disabled={!addDraft.trim()}>Добавить</button>
            </div>
          </div>
        {:else}
          <div class="coll-add-row">
            <button class="ui-btn" onclick={() => ((adding = 'heading'), (addDraft = ''))}><Icon name="plus" size={16} />Заголовок</button>
            <button class="ui-btn" onclick={() => ((adding = 'text'), (addDraft = ''))}><Icon name="plus" size={16} />Текст</button>
          </div>
        {/if}
      {/if}
    {/if}
  {/if}
</div>
