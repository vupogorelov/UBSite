<script>
  import { onMount } from 'svelte';
  import { route, navigate, lastPath, parsePath } from './lib/router.svelte.js';
  import { session, startSession } from './lib/session.svelte.js';
  import { guest, backToReading } from './lib/guest.svelte.js';
  import GuestReader from './components/GuestReader.svelte';
  import { toast, runToastAction } from './lib/toast.svelte.js';
  import Shell from './components/Shell.svelte';
  import Login from './components/Login.svelte';
  import Invite from './components/Invite.svelte';
  import VerifyEmail from './components/VerifyEmail.svelte';
  import QuoteImage from './components/QuoteImage.svelte';

  const inviteToken = $derived(route.path.startsWith('/invite/') ? decodeURIComponent(route.path.slice('/invite/'.length)) : null);
  const verifyToken = $derived(route.path.startsWith('/verify-email/') ? decodeURIComponent(route.path.slice('/verify-email/'.length)) : null);

  if (route.path.split('?')[0] === '/') {
    guest.login = true; // the site itself, not a shared link: the sign-in for someone not signed in
    navigate(lastPath(), { replace: true });
  }

  onMount(startSession);
</script>

{#if inviteToken}
  <Invite token={inviteToken} />
{:else if verifyToken}
  <VerifyEmail token={verifyToken} />
{:else if !session.checked}
  <div class="state">Загрузка…</div>
{:else if !session.user && parsePath(route.path).paper !== null && !guest.login}
  <!-- a shared link to a place in the book, not signed in: read it as a guest -->
  <GuestReader />
{:else if !session.user}
  <Login onback={guest.fromReading ? backToReading : undefined} />
{:else if !session.workspace}
  <div class="state">Загрузка…</div>
{:else}
  <Shell />
{/if}
<!-- «Картинка» of a quote: for the signed in and for a guest who came by a link -->
<QuoteImage />
{#if toast.message && !session.user}<div class="toast" class:with-action={toast.action} role="status">{toast.message}{#if toast.action}<button class="toast-action" onclick={runToastAction}>{toast.action.label}</button>{/if}</div>{/if}
