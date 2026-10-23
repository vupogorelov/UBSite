<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { session, logout } from '../lib/session.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Drawer from './Drawer.svelte';
  import Icon from './Icon.svelte';
  import PasswordInput from './PasswordInput.svelte';
  import { outbox } from '../lib/outbox.svelte.js';
  import { plural } from '../lib/format.js';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  // ---- The display name ----
  let name = $state(session.user?.displayName ?? '');
  let nameError = $state('');
  let savingName = $state(false);
  const nameChanged = $derived(name.trim().replace(/\s+/g, ' ') !== (session.user?.displayName ?? ''));
  /** @param {SubmitEvent} e */
  async function saveName(e) {
    e.preventDefault();
    savingName = true;
    nameError = '';
    try {
      const r = await api.setProfile(name);
      session.user = r.user;
      name = r.user.displayName ?? '';
      showToast(r.user.displayName ? `Теперь вас видят как «${r.user.displayName}»` : 'Имя убрано — показывается логин');
    } catch (err) {
      nameError = /** @type {Error} */ (err).message;
    } finally {
      savingName = false;
    }
  }

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

  // ---- E-mail: for restoring a forgotten password; it counts once confirmed by the letter's link ----
  let mail = $state(false);
  onMount(() => {
    api.registration().then((r) => (mail = r.mail), () => {});
  });
  let editingEmail = $state(false);
  let email = $state('');
  let emailPassword = $state('');
  let emailError = $state('');
  let busy = $state(false);

  function startEmail() {
    email = session.user?.email ?? '';
    emailPassword = emailError = '';
    editingEmail = true;
  }
  /** @param {SubmitEvent} e */
  async function saveEmail(e) {
    e.preventDefault();
    busy = true;
    try {
      const r = await api.setEmail(email.trim(), emailPassword);
      session.user = r.user;
      editingEmail = false;
      showToast(email.trim() ? 'Мы отправили письмо — подтвердите в нём почту' : 'Почта удалена');
    } catch (err) {
      emailError = /** @type {Error} */ (err).message;
    } finally {
      busy = false;
    }
  }
  async function resend() {
    try {
      await api.resendEmail();
      showToast('Письмо отправлено ещё раз — проверьте и «Спам»');
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  }
</script>

<Drawer title={session.user?.displayName ?? session.user?.username ?? ''} subtitle={`Вход как ${session.user?.username}`} {onclose}>
  <!-- The name others see; the login stays for signing in and @mentions -->
  <div class="ui-label acc-label">Профиль</div>
  <form class="ui-card acc-card" onsubmit={saveName}>
    <label class="acc-field" for="acc-name">Отображаемое имя</label>
    <input id="acc-name" class="ui-input" bind:value={name} maxlength="80" autocomplete="name" placeholder={session.user?.username ?? ''} />
    <p class="ui-hint">Так вас видят другие — в чатах, обсуждениях и заметках. Пусто — показывается логин.
      Логин <b>@{session.user?.username}</b> остаётся для входа и упоминаний.</p>
    {#if nameError}<div class="search-error" role="alert">{nameError}</div>{/if}
    <div class="acc-actions"><button class="ui-btn primary" disabled={!nameChanged || savingName}>Сохранить</button></div>
  </form>

  {#if mail}
    <div class="ui-label acc-label">Почта</div>
    <section class="ui-card acc-card">
      {#if editingEmail}
        <form class="account-email" onsubmit={saveEmail}>
          <label class="acc-field" for="acc-email">Адрес (пусто — удалить)</label>
          <input id="acc-email" class="ui-input" type="email" bind:value={email} maxlength="254" autocomplete="email" />
          <label class="acc-field" for="acc-email-pass">Текущий пароль</label>
          <PasswordInput id="acc-email-pass" cls="ui-input" bind:value={emailPassword} />
          {#if emailError}<div class="search-error" role="alert">{emailError}</div>{/if}
          <div class="acc-actions">
            <button type="button" class="ui-btn" onclick={() => (editingEmail = false)}>Отмена</button>
            <button class="ui-btn primary" disabled={busy}>Сохранить</button>
          </div>
        </form>
      {:else if session.user?.email}
        <p class="account-email-line">
          <b>{session.user.email}</b>
          {#if session.user.emailVerified}<span class="status-badge" data-status="approved">подтверждена</span>{:else}<span class="status-badge">не подтверждена</span>{/if}
        </p>
        {#if !session.user.emailVerified}
          <p class="ui-hint">Откройте ссылку из письма — после этого по почте можно будет восстановить пароль.
            <button class="link-btn" onclick={resend}>Отправить письмо ещё раз</button></p>
        {:else}
          <p class="ui-hint">Если забудете пароль, на странице входа нажмите «Забыли пароль?» — ссылка придёт сюда.</p>
        {/if}
        <div class="acc-actions"><button class="ui-btn" onclick={startEmail}>Изменить</button></div>
      {:else}
        <p class="ui-hint">Почта не указана. С ней забытый пароль можно восстановить самому, без администратора.</p>
        <div class="acc-actions"><button class="ui-btn primary" onclick={startEmail}>Указать почту</button></div>
      {/if}
    </section>
  {/if}

  <div class="ui-label acc-label">Смена пароля</div>
  <form class="ui-card acc-card" onsubmit={change}>
    <label class="acc-field" for="acc-cur">Текущий пароль</label>
    <PasswordInput id="acc-cur" cls="ui-input" bind:value={currentPassword} />
    <label class="acc-field" for="acc-new">Новый пароль (не короче 8 символов)</label>
    <PasswordInput id="acc-new" cls="ui-input" bind:value={next} autocomplete="new-password" minlength={8} />
    <label class="acc-field" for="acc-new2">Новый пароль ещё раз</label>
    <PasswordInput id="acc-new2" cls="ui-input" bind:value={next2} autocomplete="new-password" minlength={8} />
    {#if error}<div class="search-error" role="alert">{error}</div>{/if}
    <div class="acc-actions"><button class="ui-btn primary" type="submit">Сменить</button></div>
  </form>
  {#if outbox.items.length}
    <!-- changes still on this device: signing out leaves them unsent -->
    <p class="ui-hint acc-unsent"><Icon name="clock" size={14} />{outbox.items.length} {plural(outbox.items.length, 'изменение ещё не отправлено', 'изменения ещё не отправлены', 'изменений ещё не отправлено')} — после выхода они не уйдут.</p>
  {/if}
  <button class="ui-btn danger-text acc-logout" onclick={() => (onclose(), logout())}><Icon name="back" size={18} />{outbox.items.length ? 'Выйти всё равно' : 'Выйти'}</button>
</Drawer>
