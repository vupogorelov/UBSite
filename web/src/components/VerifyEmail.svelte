<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/router.svelte.js';
  import { session } from '../lib/session.svelte.js';

  /** /verify-email/<token>: the link from the confirmation letter (works signed in or not). @type {{ token: string }} */
  let { token } = $props();

  /** @type {string | null} */ let email = $state(null);
  let error = $state('');

  onMount(() => {
    api.verifyEmail(token).then(
      (r) => {
        email = r.email;
        if (session.user) session.user = { ...session.user, emailVerified: true };
      },
      (err) => (error = err.message),
    );
  });
</script>

<main class="auth-page">
  <div class="auth-card">
    <h1>Urantia Papers Explorer</h1>
    {#if email}
      <p>Почта <b>{email}</b> подтверждена. Если забудете пароль, нажмите «Забыли пароль?» на странице входа — ссылка придёт на этот адрес.</p>
    {:else if error}
      <div class="search-error" role="alert">{error}</div>
      <p class="hint">Отправьте письмо ещё раз из «Аккаунт и пароль».</p>
    {:else}
      <p class="muted">Проверяем ссылку…</p>
    {/if}
    <button class="btn primary wide" onclick={() => navigate('/', { replace: true })}>Открыть приложение</button>
  </div>
</main>
