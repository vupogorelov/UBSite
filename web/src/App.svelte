<script>
  import { onMount } from 'svelte';
  import { route, navigate, lastPath } from './lib/router.svelte.js';
  import { session, startSession } from './lib/session.svelte.js';
  import { toast } from './lib/toast.svelte.js';
  import Shell from './components/Shell.svelte';
  import Login from './components/Login.svelte';
  import Invite from './components/Invite.svelte';

  const inviteToken = $derived(route.path.startsWith('/invite/') ? decodeURIComponent(route.path.slice('/invite/'.length)) : null);

  if (route.path === '/') navigate(lastPath(), { replace: true });

  onMount(startSession);
</script>

{#if inviteToken}
  <Invite token={inviteToken} />
{:else if !session.checked}
  <div class="state">Загрузка…</div>
{:else if !session.user}
  <Login />
{:else if !session.workspace}
  <div class="state">Загрузка…</div>
{:else}
  <Shell />
{/if}
{#if toast.message && !session.user}<div class="toast" role="status">{toast.message}</div>{/if}
