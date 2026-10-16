<script>
  import { api } from '../lib/api.js';
  import { session, refreshWorkspaces, switchWorkspace } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { copyText } from '../lib/notes.svelte.js';
  import Drawer from './Drawer.svelte';
  import Icon from './Icon.svelte';
  import UiSelect from './UiSelect.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  const ROLE_NAMES = /** @type {const} */ ({ owner: 'Владелец', editor: 'Редактор', commenter: 'Комментатор', viewer: 'Читатель' });
  const ROLES = /** @type {const} */ (['owner', 'editor', 'commenter', 'viewer']);
  /** What each role may do (the hint in the choice). */
  const ROLE_HINTS = /** @type {const} */ ({
    owner: 'Участники, название, удаление пространства',
    editor: 'Заметки, теги, подборки',
    commenter: 'Читает и комментирует',
    viewer: 'Только читает',
  });
  const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_NAMES[r], hint: ROLE_HINTS[r] }));
  /** @param {string | null} name */
  const initial = (name) => (name ?? '?').trim().slice(0, 1).toUpperCase();

  /** @type {number | null} */
  let selectedId = $state(session.workspace?.kind === 'group' ? session.workspace.id : null);
  const selected = $derived(session.workspaces.find((w) => w.id === selectedId) ?? null);
  /** @type {import('../lib/api.js').Member[]} */
  let members = $state([]);
  let newName = $state('');
  let rename = $state('');
  let addUser = $state('');
  /** People of the platform not in the chosen group yet (its owner adds them). @type {{ username: string, name: string }[]} */
  let candidates = $state([]);
  const candidateOptions = $derived(candidates.map((c) => ({ value: c.username, label: c.name, hint: `@${c.username}` })));
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
    addUser = '';
    api.members(ws.id).then((m) => (members = m), (err) => showToast(err.message));
    loadCandidates(ws);
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

  /** @param {{ id: number, role: string }} ws */
  function loadCandidates(ws) {
    if (ws.role !== 'owner') return void (candidates = []);
    api.workspaceCandidates(ws.id).then((c) => (candidates = c), () => (candidates = []));
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
      loadCandidates(/** @type {any} */ (selected));
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
      loadCandidates(selected);
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
  <div class="ws-panel">
    <div class="ui-label">Мои пространства</div>
    <!-- a row each: open it, or (a group) choose it to manage below -->
    <div class="more-group ws-group">
      {#each session.workspaces as w (w.id)}
        {@const current = w.id === session.workspace?.id}
        <div class="ws-row" class:chosen={w.id === selectedId}>
          <button class="ws-row-main" onclick={() => (selectedId = w.kind === 'group' ? (selectedId === w.id ? null : w.id) : null)}
            aria-expanded={w.kind === 'group' ? w.id === selectedId : undefined}>
            <span class="ui-tile ws-tile"><Icon name={w.kind === 'personal' ? 'lock' : 'users'} size={18} /></span>
            <span class="ws-name"><b>{w.kind === 'personal' ? 'Личное' : w.name}</b>
              <span>{w.kind === 'personal' ? 'Только вы' : ROLE_NAMES[w.role]}{current ? ' · открыто' : ''}</span></span>
          </button>
          {#if current}
            <span class="ws-current" title="Открыто сейчас"><Icon name="check" size={18} /></span>
          {:else}
            <button class="ui-chip ws-open" onclick={() => switchWorkspace(w.id)}>Открыть</button>
          {/if}
        </div>
      {/each}
    </div>
    <form class="ui-search ui-add ws-add" onsubmit={(e) => (e.preventDefault(), create())}>
      <Icon name="layers" size={18} />
      <input placeholder="Новое групповое пространство" bind:value={newName} maxlength="80" aria-label="Название нового пространства" />
      <button class="ui-round primary" disabled={!newName.trim()} aria-label="Создать пространство" title="Создать"><Icon name="plus" size={18} /></button>
    </form>
    {#if session.workspaces.some((w) => w.kind === 'group') && !selected}
      <p class="ui-hint">Нажмите на групповое пространство, чтобы увидеть участников и пригласить новых.</p>
    {/if}

    {#if selected}
      {@const owner = selected.role === 'owner'}
      <div class="ui-label ws-section">«{selected.name}»</div>
      {#if owner}
        <form class="ui-search ui-add" onsubmit={(e) => (e.preventDefault(), saveName())}>
          <Icon name="edit" size={18} />
          <input bind:value={rename} maxlength="80" aria-label="Название пространства" />
          {#if rename.trim() !== selected.name && rename.trim()}
            <button class="ui-round primary" aria-label="Переименовать" title="Переименовать"><Icon name="check" size={18} /></button>
          {/if}
        </form>
      {/if}

      <div class="ui-label">Участники · {members.length}</div>
      <div class="more-group ws-group">
        {#each members as m (m.userId)}
          {@const me = m.userId === session.user?.id}
          <div class="ws-row ws-member">
            <span class="ws-avatar">{initial(m.displayName ?? m.username)}</span>
            <span class="ws-name"><b>{m.displayName ?? m.username}</b><span>@{m.username}{me ? ' · вы' : ''}</span></span>
            {#if owner}
              <UiSelect variant="inline" class="ws-role" title="Роль: {m.displayName ?? m.username}" value={m.role}
                onchange={(x) => setRole(m.userId, /** @type {any} */ (x))} options={roleOptions} />
            {:else}
              <span class="ws-role-text">{ROLE_NAMES[m.role]}</span>
            {/if}
            {#if owner || me}
              <button class="ui-round small plain" title={me ? 'Покинуть пространство' : 'Исключить'}
                aria-label={me ? 'Покинуть пространство' : `Исключить ${m.username}`} onclick={() => remove(m.userId)}><Icon name="close" size={16} /></button>
            {/if}
          </div>
        {/each}
      </div>

      {#if owner}
        <div class="ui-label">Добавить пользователя платформы</div>
        <form class="ui-card ws-card" onsubmit={(e) => (e.preventDefault(), add())}>
          <UiSelect class="ws-role-row ws-person" icon="users" label="Пользователь" title="Кого добавить" placeholder="Выбрать" searchable
            empty="Все пользователи платформы уже в этом пространстве" value={addUser} onchange={(x) => (addUser = x)} options={candidateOptions} />
          <div class="ws-card-row">
            <UiSelect class="ws-role-row" label="Роль" title="Роль нового участника" value={addRole}
              onchange={(x) => (addRole = /** @type {any} */ (x))} options={roleOptions} />
            <button class="ui-btn primary" type="submit" disabled={!addUser.trim()}>Добавить</button>
          </div>
        </form>

        <div class="ui-label">Пригласить нового человека по ссылке</div>
        <div class="ui-card ws-card">
          <div class="ws-card-row">
            <UiSelect class="ws-role-row" label="Роль" title="Роль по приглашению" value={inviteRole}
              onchange={(x) => (inviteRole = /** @type {any} */ (x))} options={roleOptions} />
            <button class="ui-btn" onclick={invite}><Icon name="link" size={16} />Создать ссылку</button>
          </div>
          {#if inviteUrl}
            <div class="ws-invite">
              <code>{inviteUrl}</code>
              <button class="ui-chip" onclick={() => copyText(inviteUrl)}><Icon name="copy" size={14} />Копировать</button>
            </div>
          {/if}
          <p class="ui-hint">Ссылка одноразовая, действует 7 дней. По ней человек создаст учётную запись и сразу попадёт в это пространство.</p>
        </div>

        <button class="ui-btn danger-text ws-delete" class:confirm={confirmDelete} onclick={removeWorkspace} onblur={() => (confirmDelete = false)}>
          <Icon name="trash" size={18} />{confirmDelete ? 'Нажмите ещё раз — удалить вместе с заметками и тегами' : 'Удалить пространство'}
        </button>
      {/if}
    {/if}
  </div>
</Drawer>
