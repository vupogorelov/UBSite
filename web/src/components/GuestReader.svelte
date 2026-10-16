<script>
  import { applySettings } from '../lib/settings.svelte.js';
  import { view } from '../lib/router.svelte.js';
  import { paperLabel } from '../lib/format.js';
  import { device } from '../lib/mobile.svelte.js';
  import { guest, openLogin } from '../lib/guest.svelte.js';
  import Reader from './Reader.svelte';

  /**
   * The book for a guest — someone who came by a shared link to a paragraph or a quote, not signed in:
   * a quiet header (where in the book, «Войти») over the reader. The marks of discussions and variants
   * of translation show their numbers; reaching for them asks to sign in (lib/guest.svelte.js), and
   * after signing in the same place opens in the full app.
   */
  $effect(applySettings);
</script>

<div class="guest-app" class:mobile={device.mobile}>
  <header class="guest-bar">
    <span class="guest-where">
      <span class="guest-kicker">Книга Урантии</span>
      <b>{view.paper !== null ? paperLabel(view.paper) : ''}</b>
    </span>
    <button class="ui-btn primary guest-login" onclick={openLogin}>Войти</button>
  </header>
  <main class="guest-main"><Reader /></main>
</div>

{#if guest.ask}
  <!-- something that takes an account: what it is, and the way in -->
  <button class="sheet-scrim" aria-label="Закрыть" onclick={() => (guest.ask = '')}></button>
  <div class="sheet guest-ask" role="dialog" aria-labelledby="guest-ask-title">
    <div class="sheet-grip" aria-hidden="true"></div>
    <b id="guest-ask-title">Войдите, чтобы открыть {guest.ask}</b>
    <p class="muted">Обсуждения, варианты перевода и заметки видны участникам платформы — там их читают и пишут. После входа вы вернётесь к этому месту.</p>
    <div class="guest-ask-actions">
      <button class="ui-btn primary" onclick={openLogin}>Войти</button>
      <button class="ui-btn" onclick={() => (guest.ask = '')}>Не сейчас</button>
    </div>
  </div>
{/if}
