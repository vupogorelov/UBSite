<script>
  import { api } from '../lib/api.js';
  import { session, logout } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Drawer from './Drawer.svelte';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  let currentPassword = $state('');
  let next = $state('');
  let next2 = $state('');
  let error = $state('');

  /** @param {SubmitEvent} e */
  async function change(e) {
    e.preventDefault();
    if (next !== next2) {
      error = 'Новые пароли не совпадают';
      return;
    }
    try {
      await api.changePassword(currentPassword, next);
      currentPassword = next = next2 = error = '';
      showToast('Пароль изменён. Другие ваши сеансы завершены.');
    } catch (err) {
      error = /** @type {Error} */ (err).message;
    }
  }
</script>

<Drawer title={session.user?.displayName ?? session.user?.username ?? ''} subtitle={`Вход как ${session.user?.username}`} {onclose}>
  <form class="group" onsubmit={change}>
    <div class="box-title">Смена пароля</div>
    <label class="setting-label" for="acc-cur">Текущий пароль</label>
    <input id="acc-cur" class="text-input" type="password" bind:value={currentPassword} autocomplete="current-password" required />
    <label class="setting-label" for="acc-new">Новый пароль (не короче 8 символов)</label>
    <input id="acc-new" class="text-input" type="password" bind:value={next} autocomplete="new-password" minlength="8" required />
    <label class="setting-label" for="acc-new2">Новый пароль ещё раз</label>
    <input id="acc-new2" class="text-input" type="password" bind:value={next2} autocomplete="new-password" minlength="8" required />
    {#if error}<div class="search-error" role="alert">{error}</div>{/if}
    <div class="row-end"><button class="btn primary" type="submit">Сменить</button></div>
  </form>
  <button class="btn wide" onclick={() => (onclose(), logout())}>Выйти</button>
</Drawer>
