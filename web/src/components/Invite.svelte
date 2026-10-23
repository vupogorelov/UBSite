<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { session, refreshWorkspaces } from '../lib/session.svelte.js';
  import { navigate, lastPath } from '../lib/router.svelte.js';
  import PasswordInput from './PasswordInput.svelte';

  /** @type {{ token: string }} */
  let { token } = $props();

  let info = $state(/** @type {Awaited<ReturnType<typeof api.invite>> | null} */ (null));
  let loadError = $state('');
  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let password2 = $state('');
  let error = $state('');
  let busy = $state(false);

  const ROLE_NAMES = { owner: 'владелец', editor: 'редактор', commenter: 'комментатор', viewer: 'читатель' };

  onMount(() => {
    api.invite(token).then((i) => (info = i), (err) => (loadError = err.message));
  });

  /** @param {SubmitEvent} e */
  async function submit(e) {
    e.preventDefault();
    if (password !== password2) {
      error = 'Пароли не совпадают';
      return;
    }
    busy = true;
    error = '';
    try {
      const body = info?.kind === 'account' ? { username: username.trim(), displayName: displayName.trim(), password } : { password };
      session.user = (await api.acceptInvite(token, body)).user;
      await refreshWorkspaces();
      navigate(lastPath(), { replace: true });
    } catch (err) {
      error = /** @type {Error} */ (err).message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    <h1>Urantia Papers Explorer</h1>
    {#if loadError}
      <div class="search-error" role="alert">{loadError}</div>
      <p class="hint">Попросите новую ссылку у того, кто вас пригласил.</p>
    {:else if !info}
      <p class="muted">Проверяем ссылку…</p>
    {:else if info.kind === 'reset'}
      <p>Новый пароль для <b>{info.username}</b></p>
    {:else}
      <p>Создание учётной записи{#if info.workspaceName}: вас приглашают в пространство <b>«{info.workspaceName}»</b>
        как {ROLE_NAMES[info.role ?? 'viewer']}{/if}.</p>
      <label class="setting-label" for="inv-user">Имя для входа</label>
      <input id="inv-user" class="text-input" bind:value={username} autocomplete="username" required
        pattern={'[\\p{L}\\p{N}_.\\-]{2,40}'} title="2–40 символов: буквы, цифры, _ . -" />
      <label class="setting-label" for="inv-name">Как вас показывать другим (необязательно)</label>
      <input id="inv-name" class="text-input" bind:value={displayName} maxlength="80" />
    {/if}
    {#if info}
      <label class="setting-label" for="inv-pass">Пароль (не короче 8 символов)</label>
      <PasswordInput id="inv-pass" bind:value={password} autocomplete="new-password" minlength={8} />
      <label class="setting-label" for="inv-pass2">Пароль ещё раз</label>
      <PasswordInput id="inv-pass2" bind:value={password2} autocomplete="new-password" minlength={8} />
      {#if error}<div class="search-error" role="alert">{error}</div>{/if}
      <button class="btn primary wide" type="submit" disabled={busy}>{info.kind === 'reset' ? 'Сохранить пароль' : 'Создать и войти'}</button>
    {/if}
  </form>
</main>
