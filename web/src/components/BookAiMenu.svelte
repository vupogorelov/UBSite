<script>
  import { onMount } from 'svelte';
  import { myAi, loadMyAi, connectMyAi, disconnectMyAi } from '../lib/ai.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import { portal } from '../lib/portal.js';
  import { swipeClose } from '../lib/swipe.js';
  import { onBack } from '../lib/router.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * «Я и Книга»'s header, by the magnifier: who writes the Book's own words — the reader's own AI, or the
   * application's shared answers (how many are left today) — opened as the bell's list is (a sheet on the phone,
   * a menu on the computer); the way to connect one's own AI, or to let it go. Honest about it: the question and
   * the paragraphs go to an outside AI (VISION.md, 5). `answers`: the Book's answers so far (one more — the count
   * is read again).
   * @type {{ answers: number }}
   */
  let { answers } = $props();

  let open = $state(false);
  $effect(() => {
    if (open) return onBack(() => void (open = false));
  });

  onMount(loadMyAi);
  let seen = -1;
  $effect(() => {
    if (seen !== -1 && answers !== seen) loadMyAi();
    seen = answers;
  });

  const s = $derived(myAi.state);
  /** None left today, or none connected: the Book answers with the paragraphs alone. */
  const none = $derived(!!s && !s.own && !(s.shared && s.shared.left > 0));
  const label = $derived(s?.own ? `Ответы своими словами: ваш ИИ · ${s.own.title}` : s?.shared && s.shared.left > 0 ? `Ответы своими словами: осталось ${s.shared.left} из ${s.shared.of} сегодня` : 'Ответы своими словами');
</script>

<div class="user-menu">
  <button class="icon-btn book-ai-btn" class:off={none} onclick={() => ((open = !open), open && loadMyAi())} aria-haspopup="dialog" aria-expanded={open}
    title={label} aria-label={label}><Icon name="sparkles" /></button>
  {#if open}
    {#snippet content()}
      <div class="ui-empty book-ai">
        <span class="ui-tile big"><Icon name="sparkles" size={22} /></span>
        {#if !s}
          <p class="muted small">Загрузка…</p>
        {:else if s.own}
          <b>Отвечает ваш ИИ</b>
          <p class="muted small">Книга отвечает своими словами — коротко, со ссылками на абзацы — через ваш {s.own.title}: вопрос и найденные
            абзацы получает он. Ответ можно проверить по абзацам под ним.</p>
          <button class="ui-chip" onclick={disconnectMyAi}>Отключить свой ИИ</button>
        {:else if s.shared && s.shared.left > 0}
          <b>Ответов своими словами сегодня: {s.shared.left} из {s.shared.of}</b>
          <p class="muted small">Это общий запас приложения на день. Отвечает внешний ИИ (OpenRouter): вопрос и найденные абзацы получает он,
            ответ можно проверить по абзацам под ним. Подключите свой — и ответы своими словами будут вашими, без общего запаса.</p>
          <button class="ui-chip on" onclick={connectMyAi}>Подключить свой ИИ</button>
        {:else}
          <b>{s.shared ? 'Общие ответы на сегодня закончились' : 'Книга отвечает абзацами'}</b>
          <p class="muted small">{s.shared ? 'Сейчас Книга отвечает абзацами. ' : ''}Подключите свой ИИ — бесплатно, вход через OpenRouter в браузере —
            и Книга будет отвечать своими словами: коротко, со ссылками на абзацы.</p>
          <button class="ui-chip on" onclick={connectMyAi}>Подключить свой ИИ</button>
        {/if}
      </div>
    {/snippet}

    {#if device.mobile}
      <!-- phone: a sheet from the bottom, as the bell's -->
      <div use:portal>
        <button class="sheet-scrim" aria-label="Закрыть" onclick={() => (open = false)}></button>
        <div class="sheet ui-sheet notif-sheet" role="dialog" aria-label="Ответы своими словами" use:swipeClose={{ dirs: ['down'], onclose: () => (open = false) }}>
          <div class="sheet-grip" aria-hidden="true"></div>
          <div class="ui-sheet-head">
            <button class="ui-round plain" onclick={() => (open = false)} aria-label="Закрыть"><Icon name="close" /></button>
            <b>Ответы своими словами</b>
            <span></span>
          </div>
          <div class="notif-scroll">{@render content()}</div>
        </div>
      </div>
    {:else}
      <button class="menu-scrim" aria-label="Закрыть" onclick={() => (open = false)}></button>
      <div class="menu notif-menu" role="dialog" aria-label="Ответы своими словами">
        <div class="notif-menu-head">Ответы своими словами</div>
        {@render content()}
      </div>
    {/if}
  {/if}
</div>
