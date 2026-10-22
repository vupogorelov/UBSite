<script>
  import { api } from '../lib/api.js';
  import { blurOnRemove } from '../lib/focus.js';
  import Icon from './Icon.svelte';
  import { settings } from '../lib/settings.svelte.js';

  /**
   * Telegram's input bar: a rounded field that grows with the text, the reply bar above it, @name
   * suggestions, Enter or Ctrl/⌘+Enter to send (as set; on a touch screen Enter is a new line), the round send
   * button (an arrow up), all in one pill.
   * @type {{
   *   onsend: (body: string) => Promise<unknown>, placeholder?: string,
   *   reply?: { id: number, authorName: string | null, body: string } | null, oncancelreply?: () => void,
   *   ontyping?: () => void, mentions?: boolean, disabled?: boolean, chatKey?: string | null, onescape?: () => void
   * }}
   * `chatKey`: the conversation — in a members-only one (a workspace's, a note's) only members are suggested.
   * `onescape`: Esc with nothing to cancel (a note's card closes).
   */
  let {
    onsend, placeholder = 'Сообщение', reply = null, oncancelreply, ontyping, mentions = true, disabled = false, chatKey = null,
    onescape,
  } = $props();

  const touch = matchMedia('(pointer: coarse)').matches;
  /** Apple's (Mac, iPhone, iPad): ⌘ in the send button's hint. */
  const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  let text = $state('');
  let sending = $state(false);
  /** @type {HTMLTextAreaElement | undefined} */ let field = $state();

  /** @param {FocusOptions} [opts] */
  export function focus(opts) {
    field?.focus(opts);
  }
  /** Puts text into the field (a quote to comment on), the cursor at its end. @param {string} value */
  export function fill(value) {
    text = value;
    queueMicrotask(() => {
      grow();
      field?.focus();
      field?.setSelectionRange(value.length, value.length);
      if (field) field.scrollTop = field.scrollHeight;
    });
  }
  $effect(() => {
    if (reply) field?.focus();
  });

  function grow() {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
    field.style.overflowY = field.scrollHeight > 180 ? 'auto' : 'hidden'; // no scrollbar in a short field
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    sending = true;
    try {
      if (await onsend(body)) {
        text = '';
        suggestions = [];
        queueMicrotask(grow);
      }
    } finally {
      sending = false;
      field?.focus();
    }
  }

  // ---- @mentions ----
  /** @type {{ id: number, username: string, name: string }[]} */ let suggestions = $state([]);
  let picked = $state(0);
  /** The "@prefix" right before the caret, if any. */
  function mentionAtCaret() {
    if (!field) return null;
    const before = text.slice(0, field.selectionStart);
    const m = before.match(/(^|\s)@([\p{L}\p{N}_.-]{0,40})$/u);
    return m ? { prefix: m[2], start: before.length - m[2].length - 1 } : null;
  }
  let seq = 0;
  async function suggest() {
    const at = mentions ? mentionAtCaret() : null;
    if (!at) {
      suggestions = [];
      return;
    }
    const my = ++seq;
    const list = await api.chatUsers(at.prefix, chatKey).catch(() => []);
    if (my === seq) {
      suggestions = list;
      picked = 0;
    }
  }
  /** @param {{ username: string }} u */
  function insert(u) {
    const at = mentionAtCaret();
    if (!at || !field) return;
    const caret = field.selectionStart;
    text = `${text.slice(0, at.start)}@${u.username} ${text.slice(caret)}`;
    suggestions = [];
    const pos = at.start + u.username.length + 2;
    queueMicrotask(() => field?.setSelectionRange(pos, pos));
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        picked = (picked + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(suggestions[picked]);
        return;
      }
      if (e.key === 'Escape') {
        suggestions = [];
        return;
      }
    }
    if (e.key === 'Escape') {
      if (reply) oncancelreply?.();
      else onescape?.();
    }
    // Settings → «Чаты» → «Отправка сообщения»: Enter (Shift+Enter — a new line) or Ctrl+Enter (⌘ on Apple's) —
    // the other, a new line; Ctrl/⌘+Enter sends always. A touch screen: Enter is a new line, the button sends (as
    // Telegram) — with a keyboard (an iPad's), ⌘+Enter
    if (e.key !== 'Enter' || e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod || (settings.chatSend !== 'mod' && !e.shiftKey && !touch)) {
      e.preventDefault();
      void send();
    }
  }
</script>

<div class="tg-composer">
  {#if suggestions.length}
    <div class="tg-suggest" role="listbox" aria-label="Упомянуть">
      {#each suggestions as u, i (u.id)}
        <button role="option" aria-selected={i === picked} class:active={i === picked} onmousedown={(e) => (e.preventDefault(), insert(u))}>
          <b>{u.name}</b><span class="muted">@{u.username}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if reply}
    <div class="tg-reply-bar">
      <Icon name="back" size={18} />
      <div class="tg-reply-text"><b>Ответ {reply.authorName ?? 'участнику'}</b><span>{reply.body}</span></div>
      <button class="icon-btn small-btn" onclick={() => oncancelreply?.()} aria-label="Отменить ответ"><Icon name="close" /></button>
    </div>
  {/if}
  <div class="tg-input-row">
    <textarea bind:this={field} bind:value={text} rows="1" {placeholder} {disabled} aria-label={placeholder} use:blurOnRemove
      oninput={() => (grow(), suggest(), text.trim() && ontyping?.())} onkeydown={onKeydown} onclick={suggest}></textarea>
    <button class="tg-send" class:ready={text.trim().length > 0} onclick={send} disabled={!text.trim() || sending || disabled}
      aria-label="Отправить" title={settings.chatSend === 'mod' ? `Отправить (${apple ? '⌘' : 'Ctrl'}+Enter)` : 'Отправить (Enter)'}>
      <!-- an arrow up (the paper plane was) -->
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
    </button>
  </div>
</div>
