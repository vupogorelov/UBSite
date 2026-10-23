<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { login, register } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import PasswordInput from './PasswordInput.svelte';

  /**
   * Sign-in; sign-up while the admin keeps registration open; "Забыли пароль?" when the platform can
   * send letters (a link to a new password goes to the account's confirmed e-mail).
   * `onback`: opened from a guest's reading (a shared link) — the way back to the text.
   * @type {{ onback?: () => void }}
   */
  let { onback } = $props();
  let mode = $state(/** @type {'login' | 'register' | 'forgot'} */ ('login'));
  let open = $state(false);
  let mail = $state(false);
  let username = $state('');
  let displayName = $state('');
  let email = $state('');
  let password = $state('');
  let password2 = $state('');
  let website = $state(''); // trap for bots: hidden from people
  let error = $state('');
  let busy = $state(false);
  let sent = $state(false);

  onMount(() => {
    api.registration().then((r) => ((open = r.open), (mail = r.mail)), () => {});
  });

  /** @param {'login' | 'register' | 'forgot'} m */
  function switchTo(m) {
    mode = m;
    error = '';
    password = '';
    password2 = '';
    sent = false;
  }

  /** @param {SubmitEvent} e */
  async function submit(e) {
    e.preventDefault();
    if (mode === 'register' && password !== password2) {
      error = 'Пароли не совпадают';
      return;
    }
    busy = true;
    error = '';
    try {
      if (mode === 'login') await login(username.trim(), password);
      else if (mode === 'forgot') {
        await api.forgot(username.trim());
        sent = true;
      } else {
        const sentLetter = await register({ username: username.trim(), displayName: displayName.trim(), password, website, email: email.trim() });
        if (email.trim()) showToast(sentLetter ? 'Мы отправили письмо — подтвердите в нём почту' : 'Письмо не отправилось — подтвердите почту позже в «Аккаунт»');
      }
    } catch (err) {
      error = /** @type {Error} */ (err).message;
      if (mode === 'login') password = '';
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth-page">
  <form class="auth-card" onsubmit={submit}>
    {#if onback}<button type="button" class="link-btn auth-back" onclick={onback}>← Вернуться к тексту</button>{/if}
    <h1>Urantia Papers Explorer</h1>
    <p class="muted">{mode === 'login' ? 'Исследовательская платформа' : mode === 'register' ? 'Новая учётная запись' : 'Восстановление пароля'}</p>
    {#if mode === 'login'}
      <label class="setting-label" for="login-user">Имя пользователя</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="login-user" class="text-input" bind:value={username} autocomplete="username" autofocus required />
      <label class="setting-label" for="login-pass">Пароль</label>
      <PasswordInput id="login-pass" bind:value={password} />
    {:else if mode === 'forgot'}
      {#if sent}
        <p>Если такая учётная запись есть и у неё подтверждена почта, мы отправили на неё письмо со ссылкой для нового
          пароля. Ссылка действует 1 час. Проверьте и папку «Спам».</p>
      {:else}
        <label class="setting-label" for="forgot-login">Имя пользователя или почта</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="forgot-login" class="text-input" bind:value={username} autocomplete="username" autofocus required />
      {/if}
    {:else}
      <label class="setting-label" for="reg-user">Имя для входа</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="reg-user" class="text-input" bind:value={username} autocomplete="username" autofocus required
        pattern={'[\\p{L}\\p{N}_.\\-]{2,40}'} title="2–40 символов: буквы, цифры, _ . -" />
      <label class="setting-label" for="reg-name">Как вас показывать другим (необязательно)</label>
      <input id="reg-name" class="text-input" bind:value={displayName} maxlength="80" autocomplete="name" />
      {#if mail}
        <label class="setting-label" for="reg-email">Почта — чтобы восстановить пароль (необязательно)</label>
        <input id="reg-email" class="text-input" type="email" bind:value={email} maxlength="254" autocomplete="email" />
      {/if}
      <label class="setting-label" for="reg-pass">Пароль (не короче 8 символов)</label>
      <PasswordInput id="reg-pass" bind:value={password} autocomplete="new-password" minlength={8} />
      <label class="setting-label" for="reg-pass2">Пароль ещё раз</label>
      <PasswordInput id="reg-pass2" bind:value={password2} autocomplete="new-password" minlength={8} />
      <input class="hp-field" name="website" bind:value={website} tabindex="-1" autocomplete="off" aria-hidden="true" />
    {/if}
    {#if error}<div class="search-error" role="alert">{error}</div>{/if}
    {#if !(mode === 'forgot' && sent)}
      <button class="btn primary wide" type="submit" disabled={busy}>
        {mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать и войти' : 'Отправить ссылку'}
      </button>
    {/if}
    {#if mode === 'login'}
      {#if open}<p class="hint">Нет учётной записи? <button type="button" class="link-btn" onclick={() => switchTo('register')}>Зарегистрироваться</button></p>{/if}
      {#if mail}
        <p class="hint"><button type="button" class="link-btn" onclick={() => switchTo('forgot')}>Забыли пароль?</button></p>
      {:else}
        <p class="hint">{open ? '' : 'Регистрация закрыта: доступ выдаётся по ссылке-приглашению. '}Забыли пароль — попросите администратора выдать ссылку для нового.</p>
      {/if}
    {:else if mode === 'forgot'}
      <p class="hint"><button type="button" class="link-btn" onclick={() => switchTo('login')}>Вернуться ко входу</button></p>
      <p class="hint">Нет почты в учётной записи — попросите администратора выдать ссылку для нового пароля.</p>
    {:else}
      <p class="hint">Уже есть учётная запись? <button type="button" class="link-btn" onclick={() => switchTo('login')}>Войти</button></p>
      <p class="hint">{mail ? 'Без почты забытый пароль восстанавливает только администратор.' : 'Пароль восстанавливает администратор — запомните его или сохраните в браузере.'}</p>
    {/if}
  </form>
</main>
