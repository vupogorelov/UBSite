<script>
  import { tick } from 'svelte';
  import { userColor, initials } from '../lib/chat.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import { copyText } from '../lib/notes.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * A conversation drawn like Telegram: bubbles (own on the right), grouped runs of one author with
   * the avatar and the tail at the end, date pills, service messages, replies, reactions.
   * Used by the chat page, paragraph threads, proposal discussions and note comments.
   * @typedef {{
   *   id: number, authorId: number | null, authorName: string | null, body: string, createdAt: string, updatedAt?: string,
   *   kind?: 'message' | 'event', hiddenAt?: string | null,
   *   reply?: { id: number, authorName: string | null, body: string } | null,
   *   reactions?: import('../lib/api.js').Reaction[]
   * }} Msg
   * @type {{
   *   messages: Msg[], me: number | null, compact?: boolean, unreadAfter?: number | null,
   *   reactions?: string[],
   *   onreply?: (m: Msg) => void, onreact?: (m: Msg, emoji: string) => void,
   *   onedit?: (m: Msg, body: string) => Promise<unknown>, ondelete?: (m: Msg) => void,
   *   onhide?: (m: Msg) => void, canhide?: boolean
   * }}
   */
  let { messages, me, compact = false, unreadAfter = null, reactions = [], onreply, onreact, onedit, ondelete, onhide, canhide = false } = $props();

  const toDate = (/** @type {string} */ s) => new Date(s.replace(' ', 'T') + 'Z');
  const dayKey = (/** @type {string} */ s) => toDate(s).toDateString();
  const time = (/** @type {string} */ s) => toDate(s).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  /** "Сегодня" / "Вчера" / "6 октября" / "6 октября 2025". @param {string} s */
  function dayLabel(s) {
    const d = toDate(s);
    const now = new Date();
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  /** One run: same author, same day, less than 10 minutes apart. @param {Msg | undefined} a @param {Msg | undefined} b */
  const together = (a, b) =>
    !!a && !!b && a.kind !== 'event' && b.kind !== 'event' && a.authorId === b.authorId && dayKey(a.createdAt) === dayKey(b.createdAt) &&
    Math.abs(toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()) < 10 * 60_000;

  const rows = $derived(
    messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      return {
        m,
        own: m.authorId !== null && m.authorId === me,
        day: !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt),
        first: !together(prev, m),
        last: !together(m, next),
        unread: unreadAfter !== null && m.id > unreadAfter && (!prev || prev.id <= unreadAfter) && m.authorId !== me,
      };
    }),
  );

  /** Text with @mentions, paragraph references (5:1.2 → the book) and links. @param {string} text */
  function tokens(text) {
    /** @type {{ t: 'text' | 'mention' | 'ref' | 'url', v: string }[]} */
    const out = [];
    const re = /(@[\p{L}\p{N}_.-]{2,40})|(\b\d{1,3}:\d{1,2}\.\d{1,3}\b)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/gu;
    let at = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > at) out.push({ t: 'text', v: text.slice(at, m.index) });
      out.push({ t: m[1] ? 'mention' : m[2] ? 'ref' : 'url', v: m[0] });
      at = m.index + m[0].length;
    }
    if (at < text.length) out.push({ t: 'text', v: text.slice(at) });
    return out;
  }

  // ---- Context menu (right click, long press) and inline editing ----
  /** @type {{ m: Msg, own: boolean, x: number, y: number } | null} */
  let menu = $state(null);
  /** @param {MouseEvent} e @param {Msg} m @param {boolean} own */
  function openMenu(e, m, own) {
    if (m.kind === 'event') return;
    e.preventDefault();
    menu = { m, own, x: Math.min(e.clientX, innerWidth - 230), y: Math.min(e.clientY, innerHeight - 260) };
  }
  let pressTimer = 0;
  /** @param {PointerEvent} e @param {Msg} m @param {boolean} own */
  function pressStart(e, m, own) {
    if (e.pointerType !== 'touch') return;
    pressTimer = window.setTimeout(() => openMenu(/** @type {any} */ (e), m, own), 450);
  }
  const pressEnd = () => clearTimeout(pressTimer);

  /** @type {number | null} */ let editingId = $state(null);
  let draft = $state('');
  async function saveEdit() {
    const m = messages.find((x) => x.id === editingId);
    if (!m || !onedit || !draft.trim()) return;
    if (await onedit(m, draft.trim())) editingId = null;
  }

  /** Scrolls to a quoted message and flashes it. @param {number} id */
  export async function reveal(id) {
    await tick();
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === 'Escape' && (menu = null)} onscroll={() => (menu = null)} />

<div class="tg" class:compact>
  {#each rows as { m, own, day, first, last, unread } (m.id)}
    {#if day}<div class="tg-service tg-date"><span>{dayLabel(m.createdAt)}</span></div>{/if}
    {#if unread}<div class="tg-unread"><span>Непрочитанные сообщения</span></div>{/if}
    {#if m.kind === 'event'}
      <div class="tg-service" id="msg-{m.id}"><span>{m.body}</span></div>
    {:else}
      <div class="tg-row" class:own class:first class:last id="msg-{m.id}">
        {#if !own && !compact}
          <span class="tg-avatar-slot">
            {#if last}<span class="tg-avatar" style:--c={userColor(m.authorId)} title={m.authorName ?? ''}>{initials(m.authorName)}</span>{/if}
          </span>
        {/if}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tg-bubble" class:tail={last} class:hidden-msg={!!m.hiddenAt}
          oncontextmenu={(e) => openMenu(e, m, own)} ondblclick={() => onreply?.(m)}
          onpointerdown={(e) => pressStart(e, m, own)} onpointerup={pressEnd} onpointercancel={pressEnd} onpointermove={pressEnd}>
          {#if !own && first}<div class="tg-name" style:color={userColor(m.authorId)}>{m.authorName ?? 'Участник'}</div>{/if}
          {#if m.reply}
            <button class="tg-quote" style:--c={userColor(null)} onclick={() => m.reply && reveal(m.reply.id)}>
              <b>{m.reply.authorName ?? 'Участник'}</b><span>{m.reply.body || 'Сообщение скрыто'}</span>
            </button>
          {/if}
          {#if editingId === m.id}
            <!-- svelte-ignore a11y_autofocus -->
            <textarea class="tg-edit" bind:value={draft} autofocus rows="3"
              onkeydown={(e) => (e.key === 'Enter' && !e.shiftKey ? (e.preventDefault(), saveEdit()) : e.key === 'Escape' && (editingId = null))}></textarea>
            <div class="tg-edit-actions">
              <button class="link-btn small" onclick={() => (editingId = null)}>Отмена</button>
              <button class="link-btn small" onclick={saveEdit}>Сохранить</button>
            </div>
          {:else if m.hiddenAt && !m.body}
            <div class="tg-text muted"><i>Сообщение скрыто координатором</i></div>
          {:else}
            <div class="tg-text">
              {#each tokens(m.body) as tok, i (i)}
                {#if tok.t === 'mention'}<span class="tg-mention">{tok.v}</span>
                {:else if tok.t === 'ref'}<a class="tg-link" href="/{tok.v}" onclick={(e) => (e.preventDefault(), navigate(`/${tok.v}`))}>{tok.v}</a>
                {:else if tok.t === 'url'}<a class="tg-link" href={tok.v} target="_blank" rel="noopener noreferrer">{tok.v}</a>
                {:else}{tok.v}{/if}
              {/each}
              <span class="tg-meta-space"></span>
            </div>
          {/if}
          {#if m.reactions?.length}
            <div class="tg-reactions">
              {#each m.reactions as r (r.emoji)}
                <button class="tg-reaction" class:mine={r.mine} title={r.who} onclick={() => onreact?.(m, r.emoji)} disabled={!onreact}>
                  <span>{r.emoji}</span>{r.n}
                </button>
              {/each}
            </div>
          {/if}
          <span class="tg-meta">
            {#if m.hiddenAt && m.body}<span title="Скрыто координатором">скрыто ·</span>{/if}
            {#if m.updatedAt && m.updatedAt !== m.createdAt}<span>изм.</span>{/if}
            {time(m.createdAt)}
            {#if own}<Icon name="check" size={13} />{/if}
          </span>
        </div>
        {#if onreply && editingId !== m.id}
          <button class="tg-hover-reply" onclick={() => onreply?.(m)} aria-label="Ответить" title="Ответить (или двойной щелчок)"><Icon name="back" size={14} /></button>
        {/if}
      </div>
    {/if}
  {/each}
</div>

{#if menu}
  {@const cur = menu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="tg-menu" style:left="{cur.x}px" style:top="{cur.y}px" onclick={(e) => e.stopPropagation()}>
    {#if onreact && reactions.length}
      <div class="tg-menu-reactions">
        {#each reactions as r (r)}<button onclick={() => (onreact?.(cur.m, r), (menu = null))} aria-label="Реакция {r}">{r}</button>{/each}
      </div>
    {/if}
    {#if onreply}<button onclick={() => (onreply?.(cur.m), (menu = null))}><Icon name="back" size={16} />Ответить</button>{/if}
    <button onclick={() => (copyText(cur.m.body), (menu = null))}><Icon name="copy" size={16} />Копировать текст</button>
    {#if cur.own && onedit}
      <button onclick={() => ((editingId = cur.m.id), (draft = cur.m.body), (menu = null))}><Icon name="edit" size={16} />Изменить</button>
    {/if}
    {#if canhide && onhide}
      <button onclick={() => (onhide?.(cur.m), (menu = null))}><Icon name="eye-off" size={16} />{cur.m.hiddenAt ? 'Показать' : 'Скрыть (координатор)'}</button>
    {/if}
    {#if cur.own && ondelete}
      <button class="danger-text" onclick={() => (ondelete?.(cur.m), (menu = null))}><Icon name="trash" size={16} />Удалить</button>
    {/if}
  </div>
{/if}
