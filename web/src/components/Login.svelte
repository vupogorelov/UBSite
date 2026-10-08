<script>
  import { login } from '../lib/session.svelte.js';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  /** @param {SubmitEvent} e */
  async function submit(e) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await login(username.trim(), password);
    } catch (err) {
      error = /** @type {Error} */ (err).message;
      password = '';
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    <h1>Urantian Docs Explorer</h1>
    <p class="muted">Исследовательская платформа</p>
    <label class="setting-label" for="login-user">Имя пользователя</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="login-user" class="text-input" bind:value={username} autocomplete="username" autofocus required />
    <label class="setting-label" for="login-pass">Пароль</label>
    <input id="login-pass" class="text-input" type="password" bind:value={password} autocomplete="current-password" required />
    {#if error}<div class="search-error" role="alert">{error}</div>{/if}
    <button class="btn primary wide" type="submit" disabled={busy}>Войти</button>
    <p class="hint">Регистрации нет: доступ выдаётся по ссылке-приглашению. Забыли пароль — попросите администратора выдать новую ссылку.</p>
  </form>
</main>
