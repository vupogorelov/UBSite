<script>
  import { api } from '../lib/api.js';
  import { session, refreshWorkspaces, switchWorkspace } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { copyText } from '../lib/notes.svelte.js';
  import Drawer from './Drawer.svelte';
  import Icon from './Icon.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  const ROLE_NAMES = /** @type {const} */ ({ owner: 'Владелец', editor: 'Редактор', commenter: 'Комментатор', viewer: 'Читатель' });
  const ROLES = /** @type {const} */ (['owner', 'editor', 'commenter', 'viewer']);

  /** @type {number | null} */
  let selectedId = $state(session.workspace?.kind === 'group' ? session.workspace.id : null);
  const selected = $derived(session.workspaces.find((w) => w.id === selectedId) ?? null);
  /** @type {import('../lib/api.js').Member[]} */
  let members = $state([]);
  let newName = $state('');
  let rename = $state('');
  let addUser = $state('');
  /** @type {import('../lib/api.js').Role} */
  let addRole = $state('editor');
  /** @type {import('../lib/api.js').Role} */
  let inviteRole = $state('editor');
  let inviteUrl = $state('');
  let confirmDelete = $state(false);

  $effect(() => {
    const ws = selected;
    inviteUrl = '';
    confirmDelete = false;
    if (!ws) return;
    rename = ws.name;
    api.members(ws.id).then((m) => (members = m), (err) => showToast(err.message));
  });

  /** @template T @param {() => Promise<T>} fn */
  async function act(fn) {
    try {
      return await fn();
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
      return null;
    }
  }

  async function create() {
    const ws = await act(() => api.createWorkspace(newName.trim()));
    if (!ws) return;
    newName = '';
    await refreshWorkspaces();
    selectedId = ws.id;
    await switchWorkspace(ws.id);
  }

  async function saveName() {
    if (!selected || rename.trim() === selected.name) return;
    if ((await act(() => api.renameWorkspace(/** @type {any} */ (selected).id, rename.trim()))) !== null) await refreshWorkspaces();
  }

  async function add() {
    if (!selected || !addUser.trim()) return;
    const m = await act(() => api.addMember(/** @type {any} */ (selected).id, addUser.trim(), addRole));
    if (m) {
      members = m;
      addUser = '';
    }
  }

  /** @param {number} userId @param {import('../lib/api.js').Role} role */
  async function setRole(userId, role) {
    if (!selected) return;
    const m = await act(() => api.setMemberRole(/** @type {any} */ (selected).id, userId, role));
    if (m) members = m;
    else members = await api.members(selected.id); // revert the select to the real role
  }

  /** @param {number} userId */
  async function remove(userId) {
    if (!selected) return;
    const leaving = userId === session.user?.id;
    if ((await act(() => api.removeMember(/** @type {any} */ (selected).id, userId))) === null) return;
    if (leaving) {
      selectedId = null;
      await refreshWorkspaces();
    } else {
      members = await api.members(selected.id);
    }
  }

  async function invite() {
    if (!selected) return;
    const r = await act(() => api.workspaceInvite(/** @type {any} */ (selected).id, inviteRole));
    if (r) inviteUrl = r.url;
  }

  async function removeWorkspace() {
    if (!selected) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    if ((await act(() => api.deleteWorkspace(/** @type {any} */ (selected).id))) === null) return;
    selectedId = null;
    await refreshWorkspaces();
  }
</script>

<Drawer title="Рабочие пространства" subtitle="Заметки, теги и запросы живут в пространстве" {onclose}>
  <fieldset class="group">
    <legend>Мои пространства</legend>
    <ul class="ws-list">
      {#each session.workspaces as w (w.id)}
        <li class:current={w.id === session.workspace?.id}>
          <button class="ws-item" class:active={w.id === selectedId} onclick={() => (selectedId = w.kind === 'group' ? w.id : null)}>
            <span class="ellipsis">{w.kind === 'personal' ? 'Личное' : w.name}</span>
            <span class="muted small">{w.kind === 'personal' ? 'только вы' : ROLE_NAMES[w.role]}</span>
          </button>
          {#if w.id !== session.workspace?.id}
            <button class="btn" onclick={() => switchWorkspace(w.id)}>Открыть</button>
          {:else}
            <span class="small muted">открыто</span>
          {/if}
        </li>
      {/each}
    </ul>
    <form class="notes-filters" onsubmit={(e) => (e.preventDefault(), create())}>
      <input class="text-input" placeholder="Новое групповое пространство" bind:value={newName} maxlength="80" />
      <button class="btn" type="submit" disabled={!newName.trim()}>Создать</button>
    </form>
  </fieldset>

  {#if selected}
    {@const owner = selected.role === 'owner'}
    <fieldset class="group">
      <legend>«{selected.name}»</legend>
      {#if owner}
        <form class="notes-filters" onsubmit={(e) => (e.preventDefault(), saveName())}>
          <input class="text-input" bind:value={rename} maxlength="80" aria-label="Название пространства" />
          <button class="btn" type="submit" disabled={rename.trim() === selected.name || !rename.trim()}>Переименовать</button>
        </form>
      {/if}

      <div class="box-title">Участники</div>
      <ul class="member-list">
        {#each members as m (m.userId)}
          <li>
            <span class="ellipsis">{m.displayName ?? m.username}{#if m.displayName}<span class="muted small"> · {m.username}</span>{/if}</span>
            {#if owner}
              <select class="text-input sort" value={m.role} aria-label="Роль {m.username}"
                onchange={(e) => setRole(m.userId, /** @type {any} */ (e.currentTarget.value))}>
                {#each ROLES as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
              </select>
            {:else}
              <span class="small muted">{ROLE_NAMES[m.role]}</span>
            {/if}
            {#if owner || m.userId === session.user?.id}
              <button class="icon-btn small-btn" title={m.userId === session.user?.id ? 'Покинуть пространство' : 'Исключить'}
                aria-label="Убрать участника" onclick={() => remove(m.userId)}><Icon name="close" /></button>
            {/if}
          </li>
        {/each}
      </ul>

      {#if owner}
        <div class="box-title">Добавить пользователя платформы</div>
        <form class="notes-filters" onsubmit={(e) => (e.preventDefault(), add())}>
          <input class="text-input" placeholder="Имя пользователя" bind:value={addUser} />
          <select class="text-input sort" bind:value={addRole} aria-label="Роль">
            {#each ROLES as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
          </select>
          <button class="btn" type="submit" disabled={!addUser.trim()}>Добавить</button>
        </form>
        <div class="box-title">Пригласить нового человека по ссылке</div>
        <div class="notes-filters">
          <select class="text-input" bind:value={inviteRole} aria-label="Роль по приглашению">
            {#each ROLES as r (r)}<option value={r}>{ROLE_NAMES[r]}</option>{/each}
          </select>
          <button class="btn" onclick={invite}>Создать ссылку</button>
        </div>
        {#if inviteUrl}
          <div class="invite-url">
            <code class="wrap">{inviteUrl}</code>
            <button class="btn" onclick={() => copyText(inviteUrl)}>Копировать</button>
            <p class="hint">Одноразовая, действует 7 дней. По ней человек создаст учётную запись и сразу попадёт в это пространство.</p>
          </div>
        {/if}
        <button class="link-btn danger-text" onclick={removeWorkspace} onblur={() => (confirmDelete = false)}>
          {confirmDelete ? 'Нажмите ещё раз: пространство, его заметки и теги будут удалены' : 'Удалить пространство'}
        </button>
      {/if}
    </fieldset>
  {/if}
</Drawer>
