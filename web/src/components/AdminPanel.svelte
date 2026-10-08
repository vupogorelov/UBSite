<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { session } from '../lib/session.svelte.js';
  import { tr } from '../lib/translation.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { copyText, formatTime } from '../lib/notes.svelte.js';
  import Drawer from './Drawer.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  /** @type {import('../lib/api.js').AdminUser[]} */
  let users = $state([]);
  let inviteAdmin = $state(false);
  /** @type {{ label: string, url: string } | null} */
  let link = $state(null);
  /** @type {import('../lib/api.js').VotingConfig | null} */
  let voting = $state(null);

  const load = () => api.adminUsers().then((u) => (users = u), (err) => showToast(err.message));
  onMount(() => {
    load();
    api.adminVoting().then((v) => (voting = v), (err) => showToast(err.message));
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

  async function invite() {
    const r = await act(() => api.adminInvite(inviteAdmin));
    if (r) link = { label: `Приглашение${inviteAdmin ? ' администратора' : ''}`, url: r.url };
  }

  /** @param {import('../lib/api.js').AdminUser} u */
  async function reset(u) {
    const r = await act(() => api.adminReset(u.id));
    if (r) link = { label: `Новый пароль для ${u.username}`, url: r.url };
  }

  /** @param {import('../lib/api.js').AdminUser} u @param {{ disabled?: boolean, isAdmin?: boolean, isTranslator?: boolean, isCoordinator?: boolean }} patch */
  async function update(u, patch) {
    if ((await act(() => api.adminUpdate(u.id, patch))) === null) return;
    await load();
    // Own roles changed: refresh what the interface allows.
    if (u.id === session.user?.id) session.user = (await api.me()).user;
  }

  /** @param {SubmitEvent} e */
  async function saveVoting(e) {
    e.preventDefault();
    if (!voting) return;
    const v = await act(() => api.adminSetVoting(/** @type {import('../lib/api.js').VotingConfig} */ (voting)));
    if (v) {
      voting = v;
      tr.config = v;
      showToast('Правило голосования сохранено');
    }
  }
</script>

<Drawer title="Администрирование" subtitle="Учётные записи, роли и правило голосования" {onclose}>
  <fieldset class="group">
    <legend>Новая учётная запись</legend>
    <div class="notes-filters">
      <label class="toggle small"><input type="checkbox" bind:checked={inviteAdmin} /> администратор</label>
      <span class="spacer"></span>
      <button class="btn primary" onclick={invite}>Создать ссылку</button>
    </div>
    <p class="hint">Человек сам выберет имя и пароль. В групповое пространство его можно добавить потом — или пригласить
      сразу туда из «Рабочих пространств».</p>
  </fieldset>

  {#if link}
    <div class="invite-url">
      <div class="box-title">{link.label}</div>
      <code class="wrap">{link.url}</code>
      <button class="btn" onclick={() => link && copyText(link.url)}>Копировать</button>
      <p class="hint">Одноразовая ссылка, действует 7 дней.</p>
    </div>
  {/if}

  <fieldset class="group">
    <legend>Пользователи и роли</legend>
    <p class="hint">Переводчик публикует варианты на голосование и голосует. Координатор снимает с голосования,
      отклоняет и скрывает сообщения. Администратор всегда может модерировать.</p>
    <ul class="member-list admin-users">
      {#each users as u (u.id)}
        <li class:disabled-user={u.disabled}>
          <span class="ellipsis">
            <b>{u.username}</b>{#if u.displayName}<span class="muted small"> · {u.displayName}</span>{/if}
            <span class="muted small"><br />{u.disabled ? 'отключён · ' : ''}{u.hasPassword ? '' : 'пароль не задан · '}с {formatTime(u.createdAt)}</span>
            <span class="role-flags">
              <label class="toggle small"><input type="checkbox" checked={u.isTranslator}
                onchange={(e) => update(u, { isTranslator: e.currentTarget.checked })} /> переводчик</label>
              <label class="toggle small"><input type="checkbox" checked={u.isCoordinator}
                onchange={(e) => update(u, { isCoordinator: e.currentTarget.checked })} /> координатор</label>
              <label class="toggle small"><input type="checkbox" checked={u.isAdmin} disabled={u.id === session.user?.id}
                onchange={(e) => update(u, { isAdmin: e.currentTarget.checked })} /> админ</label>
            </span>
          </span>
          <span class="row-end">
            <button class="btn" onclick={() => reset(u)} title="Ссылка для нового пароля">Пароль</button>
            {#if u.id !== session.user?.id}
              <button class="btn" onclick={() => update(u, { disabled: !u.disabled })}>{u.disabled ? 'Включить' : 'Отключить'}</button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </fieldset>

  {#if voting}
    <form class="group" onsubmit={saveVoting}>
      <div class="box-title">Правило голосования за переводы</div>
      <label class="setting-label" for="v-threshold">Доля «за» среди голосов за и против <output>{Math.round(voting.threshold * 100)}%</output></label>
      <input id="v-threshold" type="range" min="0.5" max="1" step="0.05" bind:value={voting.threshold} />
      <label class="setting-label" for="v-quorum">Кворум — минимум голосов за и против</label>
      <input id="v-quorum" class="text-input" type="number" min="1" max="100" bind:value={voting.quorum} />
      <label class="setting-label" for="v-days">Срок голосования, дней</label>
      <input id="v-days" class="text-input" type="number" min="1" max="365" bind:value={voting.durationDays} />
      <label class="toggle"><input type="checkbox" bind:checked={voting.decideEarly} /> Принимать сразу, как только правило выполнено</label>
      <label class="toggle"><input type="checkbox" bind:checked={voting.authorCanVote} /> Автор может голосовать за своё предложение</label>
      <p class="hint">Воздержавшиеся не входят ни в долю, ни в кворум. По окончании срока: правило выполнено — принято;
        кворум есть, доли нет — отклонено; кворума нет — вариант возвращается автору в черновики.
        Новое правило применяется к текущим голосованиям при следующем голосе или по окончании срока.</p>
      <div class="row-end"><button class="btn primary" type="submit">Сохранить правило</button></div>
    </form>
  {/if}
</Drawer>
