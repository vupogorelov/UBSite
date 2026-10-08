<script>
  import { notify, openList } from '../lib/notify.svelte.js';
  import { openThread } from '../lib/translation.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { formatTime } from '../lib/notes.svelte.js';
  import { ui, setTab, NARROW } from '../lib/ui.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';

  let open = $state(false);

  function toggle() {
    open = !open;
    if (open) void openList();
  }

  /** @param {import('../lib/api.js').AppNotification} n */
  function go(n) {
    open = false;
    // Channels and workspace chats open in the chat; paragraph news — in the book with its thread.
    if (n.ref.startsWith('chan:') || n.ref.startsWith('ws:')) {
      navigate(`/chat?c=${encodeURIComponent(n.ref)}`);
      return;
    }
    navigate(`/${n.ref}`);
    void openThread(n.ref, { focus: n.proposalId });
  }

  function showQueue() {
    open = false;
    ui.trScope = 'queue';
    setTab('translate');
    if (innerWidth <= NARROW) ui.sidebarOpen = true;
  }

  /** @param {string} s */
  const short = (s) => (s.length > 160 ? s.slice(0, 160).trimEnd() + '…' : s);
</script>

<div class="user-menu">
  <button class="icon-btn bell" onclick={toggle} aria-haspopup="dialog" aria-expanded={open}
    title={notify.unread ? `Уведомления: ${notify.unread} новых` : 'Уведомления'}
    aria-label={notify.unread ? `Уведомления: ${notify.unread} новых` : 'Уведомления'}>
    <Icon name="bell" />
    {#if notify.unread}<span class="tab-count">{notify.unread > 99 ? '99+' : notify.unread}</span>{/if}
  </button>
  {#if open}
    <button class="menu-scrim" aria-label="Закрыть уведомления" onclick={() => (open = false)}></button>
    <div class="menu notif-menu" role="dialog" aria-label="Уведомления">
      <div class="menu-head">Уведомления</div>
      {#if notify.queue}
        <button class="notif-queue" onclick={showQueue}>
          <Icon name="translate" size={16} />
          <span>Ждут вашего голоса: {notify.queue} {plural(notify.queue, 'предложение', 'предложения', 'предложений')}</span>
        </button>
      {/if}
      {#if notify.loading && !notify.items.length}
        <p class="muted small pad">Загрузка…</p>
      {:else if !notify.items.length}
        <p class="muted small pad">
          Пока ничего. Сюда приходят новости из обсуждений абзацев, в которых вы участвуете или за которыми следите.
        </p>
      {:else}
        <ol class="notif-list">
          {#each notify.items as n (n.id)}
            <li>
              <button class="notif" class:unread={n.unread} onclick={() => go(n)}>
                <span class="notif-head">
                  <b>{n.chatTitle ?? n.ref}</b>
                  <span class="ellipsis">{n.mention ? 'вас упомянули' : n.paperTitle ?? ''}</span>
                  <span class="notif-time">{formatTime(n.createdAt)}</span>
                </span>
                {#if n.kind === 'message'}
                  <span class="notif-body"><b>{n.authorName ?? 'Участник'}:</b> {short(n.body)}</span>
                {:else}
                  <span class="notif-body notif-event">{short(n.body)}</span>
                  {#if n.original !== null && n.text !== null}
                    <span class="notif-fragment"><del>{short(n.original)}</del> → <ins>{short(n.text)}</ins></span>
                  {/if}
                {/if}
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</div>
