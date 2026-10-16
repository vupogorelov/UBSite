<script>
  import { notify, openList } from '../lib/notify.svelte.js';
  import { openThread } from '../lib/translation.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { formatTime, notes } from '../lib/notes.svelte.js';
  import { session, switchWorkspace } from '../lib/session.svelte.js';
  import { ui, setTab, NARROW } from '../lib/ui.svelte.js';
  import { plural } from '../lib/format.js';
  import Icon from './Icon.svelte';
  import { markTitle } from '../lib/marks.js';
  import { plainBody } from '../lib/chat.svelte.js';
  import { version, restart } from '../lib/version.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import { portal } from '../lib/portal.js';
  import { swipeClose } from '../lib/swipe.js';
  import { onBack } from '../lib/router.svelte.js';

  let open = $state(false);
  // "back" closes the list (the phone's sheet especially)
  $effect(() => {
    if (open) return onBack(() => void (open = false));
  });
  /** What the news is: its tile. @param {import('../lib/api.js').AppNotification} n */
  const tile = (n) =>
    n.ref.startsWith('mark:') ? 'check-square'
    : n.mention ? 'users'
    : n.ref.startsWith('note:') ? 'comment'
    : n.kind === 'event' ? 'translate'
    : 'discuss';
  /** The bell's number: the news, and a newer build of the app (until restarted). */
  const count = $derived(notify.unread + (version.updated ? 1 : 0));
  const label = $derived(count ? `Уведомления: ${count} новых` : 'Уведомления');

  function toggle() {
    open = !open;
    if (open) void openList();
  }

  /** @param {import('../lib/api.js').AppNotification} n */
  async function go(n) {
    open = false;
    // Conversations open in the chat at the message (a paragraph's discussion too); translation news —
    // in the book with the paragraph's translations; a note's comment — the note in the book, in its workspace.
    // a mark on the user's message: the message in its chat
    if (n.ref.startsWith('mark:')) {
      if (n.markedId) navigate(`/chat?c=${encodeURIComponent(n.ref.slice(5))}&m=${n.markedId}`);
      return;
    }
    if (n.ref.startsWith('chan:') || n.ref.startsWith('ws:') || (n.proposalId === null && n.kind === 'message')) {
      navigate(`/chat?c=${encodeURIComponent(n.ref)}&m=${n.id}`);
      return;
    }
    if (n.ref.startsWith('note:')) {
      if (!n.noteRef) return;
      if (n.noteWorkspace && n.noteWorkspace !== session.workspace?.id) await switchWorkspace(n.noteWorkspace);
      navigate(`/${n.noteRef}`);
      notes.activeId = Number(n.ref.slice(5));
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
    title={label} aria-label={label}>
    <Icon name="bell" />
    {#if count}<span class="tab-count">{count > 99 ? '99+' : count}</span>{/if}
  </button>
  {#if open}
    {#snippet content()}
      {#if version.updated}
        <!-- a newer build is out: restarting takes it (the list stays as it is until then) -->
        <div class="ui-card notif-update" role="status">
          <span class="ui-tile"><Icon name="reset" size={18} /></span>
          <span class="ui-card-body"><b class="ui-card-title">Приложение обновилось</b><span class="ui-card-meta">Перезапустите, чтобы открыть новую версию</span></span>
          <button class="ui-btn primary notif-restart" onclick={restart}>Перезапустить</button>
        </div>
      {/if}
      {#if notify.queue}
        <button class="ui-card ui-card-btn notif-queue" onclick={showQueue}>
          <span class="ui-tile notif-tile-accent"><Icon name="translate" size={18} /></span>
          <span class="ui-card-body">
            <b class="ui-card-title">Ждут вашего голоса</b>
            <span class="ui-card-meta">{notify.queue} {plural(notify.queue, 'предложение', 'предложения', 'предложений')} перевода</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      {/if}
      {#if notify.loading && !notify.items.length}
        <p class="ui-hint notif-pad">Загрузка…</p>
      {:else if !notify.items.length}
        {#if !version.updated}
          <div class="ui-empty">
            <span class="ui-tile big"><Icon name="bell" size={22} /></span>
            <b>Пока ничего</b>
            <p class="muted small">Сюда приходят новости из обсуждений абзацев, в которых вы участвуете или за которыми следите,
              ответы на ваши заметки и комментарии, упоминания и отметки ваших сообщений.</p>
          </div>
        {/if}
      {:else}
        <ol class="ui-cards notif-list">
          {#each notify.items as n (n.id)}
            <li>
              <button class="ui-card ui-card-btn notif" class:unread={n.unread} onclick={() => go(n)}>
                <span class="ui-tile">
                  {#if n.ref.startsWith('mark:')}<span class="tg-mark notif-mark" data-mark={n.body}>{n.body}</span>{:else}<Icon name={/** @type {any} */ (tile(n))} size={18} />{/if}
                </span>
                <span class="ui-card-body">
                  <span class="notif-top">
                    <b class="ellipsis">{n.ref.startsWith('mark:') ? 'Ваше сообщение' : n.chatTitle ?? n.ref}</b>
                    <span class="notif-time">{formatTime(n.createdAt)}</span>
                  </span>
                  <span class="ui-card-meta">{n.ref.startsWith('mark:') ? `${markTitle(n.body)} · ${n.authorName ?? 'администратор'}` : n.mention ? 'вас упомянули' : n.ref.startsWith('note:')
                    ? (n.noteWorkspaceKind === 'group' ? n.noteWorkspaceName : 'Личное') ?? '' : n.paperTitle ?? ''}</span>
                  {#if n.ref.startsWith('mark:')}
                    <span class="notif-text">«{short(plainBody(n.markedBody ?? 'сообщение удалено'))}»</span>
                  {:else if n.kind === 'message'}
                    <span class="notif-text"><b>{n.authorName ?? 'Участник'}:</b> {short(n.body)}</span>
                  {:else}
                    <span class="notif-text notif-event">{short(n.body)}</span>
                    {#if n.original !== null && n.text !== null}
                      <span class="notif-fragment"><del>{short(n.original)}</del> → <ins>{short(n.text)}</ins></span>
                    {/if}
                  {/if}
                </span>
                {#if n.unread}<span class="notif-dot" aria-label="новое"></span>{/if}
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    {/snippet}

    {#if device.mobile}
      <!-- phone: a sheet from the bottom, over everything -->
      <div use:portal>
        <button class="sheet-scrim" aria-label="Закрыть уведомления" onclick={() => (open = false)}></button>
        <div class="sheet ui-sheet notif-sheet" role="dialog" aria-label="Уведомления" use:swipeClose={{ dirs: ['down'], onclose: () => (open = false) }}>
          <div class="sheet-grip" aria-hidden="true"></div>
          <div class="ui-sheet-head">
            <button class="ui-round plain" onclick={() => (open = false)} aria-label="Закрыть"><Icon name="close" /></button>
            <b>Уведомления</b>
            <span></span>
          </div>
          <div class="notif-scroll">{@render content()}</div>
        </div>
      </div>
    {:else}
      <button class="menu-scrim" aria-label="Закрыть уведомления" onclick={() => (open = false)}></button>
      <div class="menu notif-menu" role="dialog" aria-label="Уведомления">
        <div class="notif-menu-head">Уведомления</div>
        {@render content()}
      </div>
    {/if}
  {/if}
</div>
