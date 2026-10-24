<script>
  import { onMount } from 'svelte';
  import { myAi, loadMyAi, connectMyAi, disconnectMyAi, newTopic, loadAiRules, saveAiRules, resetAiRules } from '../lib/ai.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { device } from '../lib/mobile.svelte.js';
  import { portal } from '../lib/portal.js';
  import { swipeClose } from '../lib/swipe.js';
  import { onBack } from '../lib/router.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * «Я и Книга»'s header, by the magnifier: who writes the Book's own words — the reader's own AI, or the
   * application's shared answers (how many are left today) — opened as the bell's list is (a sheet on the phone,
   * a menu on the computer); the way to connect one's own AI, or to let it go. Honest about it: the question and
   * the paragraphs go to an outside AI (VISION.md, 5). ⚙ — how the AI answers: the reader's own rules, or the default. `answers`: the Book's answers so far (one more — the count
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
  // ---- ⚙ how the AI answers: the reader's own rules (each one's own), or the default ones ----
  let tuning = $state(false);
  let rules = $state(/** @type {import('../lib/ai.svelte.js').AiRules | null} */ (null));
  let text = $state('');
  let saving = $state(false);
  $effect(() => {
    if (!open) tuning = false;
  });
  async function tune() {
    tuning = true;
    rules = await loadAiRules();
    if (rules) text = rules.rules;
  }
  /** @param {Promise<import('../lib/ai.svelte.js').AiRules | null>} done @param {string} said */
  async function apply(done, said) {
    saving = true;
    const r = await done;
    saving = false;
    if (!r) return;
    rules = r;
    text = r.rules;
    showToast(said);
  }
  const changed = $derived(!!rules && text.trim() !== rules.rules.trim());

  const label = $derived(s?.own ? `Ответы своими словами: ваш ИИ · ${s.own.title}` : s?.shared && s.shared.left > 0 ? `Ответы своими словами: осталось ${s.shared.left} из ${s.shared.of} сегодня` : 'Ответы своими словами');
</script>

<div class="user-menu">
  <button class="icon-btn book-ai-btn" class:off={none} onclick={() => ((open = !open), open && loadMyAi())} aria-haspopup="dialog" aria-expanded={open}
    title={label} aria-label={label}><Icon name="sparkles" /></button>
  {#if open}
    {#snippet gear()}
      <button class="ui-round plain" class:on={tuning} onclick={() => (tuning ? (tuning = false) : tune())} aria-pressed={tuning}
        aria-label="Как отвечает ИИ" title="Как отвечает ИИ"><Icon name="settings" /></button>
    {/snippet}
    {#snippet content()}
      {#if tuning}
        <!-- the rules the AI is given with each question: the reader's own, or the default; the default back in a tap -->
        <div class="book-ai-rules">
          <p class="muted small">Эти указания ИИ получает с каждым вопросом: как отвечать, каким языком, насколько подробно. Они только ваши — у других свои.</p>
          {#if !rules}
            <p class="muted small">Загрузка…</p>
          {:else}
            <span class="book-ai-rules-state">{rules.own ? 'Ваши настройки' : 'Настройки по умолчанию'}</span>
            <textarea bind:value={text} rows="12" maxlength="4000" aria-label="Указания для ИИ" spellcheck="true"></textarea>
            <div class="book-ai-rules-btns">
              <button class="ui-chip on" disabled={!changed || saving} onclick={() => apply(saveAiRules(text), 'Настройки ИИ сохранены')}>Сохранить</button>
              <button class="ui-chip" disabled={(!rules.own && text.trim() === rules.default.trim()) || saving}
                onclick={() => apply(resetAiRules(), 'Возвращены настройки по умолчанию')}><Icon name="reset" size={14} />По умолчанию</button>
            </div>
          {/if}
        </div>
      {:else}
      <div class="ui-empty book-ai">
        <span class="ui-tile big"><Icon name="sparkles" size={22} /></span>
        {#if !s}
          <p class="muted small">Загрузка…</p>
        {:else if s.own}
          <b>Отвечает ваш ИИ</b>
          <p class="muted small">Книга отвечает своими словами — коротко, со ссылками на абзацы — через ваш {s.own.title}: вопрос и найденные
            абзацы получает он. Номера абзацев в ответе открывают их в книге — так ответ можно проверить.</p>
          <button class="ui-chip" onclick={disconnectMyAi}>Отключить свой ИИ</button>
        {:else if s.shared && s.shared.left > 0}
          <b>Ответов своими словами сегодня: {s.shared.left} из {s.shared.of}</b>
          <p class="muted small">Это общий запас приложения на день. Отвечает внешний ИИ (OpenRouter): вопрос и найденные абзацы получает он,
            номера абзацев в ответе открывают их в книге. Подключите свой — и ответы своими словами будут вашими, без общего запаса.</p>
          <button class="ui-chip on" onclick={connectMyAi}>Подключить свой ИИ</button>
        {:else}
          <b>{s.shared ? 'Общие ответы на сегодня закончились' : 'Книга отвечает абзацами'}</b>
          <p class="muted small">{s.shared ? 'Сейчас Книга отвечает абзацами. ' : ''}Подключите свой ИИ — бесплатно, вход через OpenRouter в браузере —
            и Книга будет отвечать своими словами: коротко, со ссылками на абзацы.</p>
          <button class="ui-chip on" onclick={connectMyAi}>Подключить свой ИИ</button>
        {/if}
        {#if s && !none}
          <!-- the conversation: the Book keeps it (the last questions, the paragraphs it answered from) — or begins anew -->
          <p class="muted small book-ai-topic">Книга помнит разговор: уточняйте и переспрашивайте. После получаса тишины разговор начинается заново — или сразу:</p>
          <button class="ui-chip" onclick={() => ((open = false), newTopic())}><Icon name="plus" size={14} />Новая тема</button>
        {/if}
      </div>
      {/if}
    {/snippet}

    {#if device.mobile}
      <!-- phone: a sheet from the bottom, as the bell's -->
      <div use:portal>
        <button class="sheet-scrim" aria-label="Закрыть" onclick={() => (open = false)}></button>
        <div class="sheet ui-sheet notif-sheet" role="dialog" aria-label="Ответы своими словами" use:swipeClose={{ dirs: ['down'], onclose: () => (open = false) }}>
          <div class="sheet-grip" aria-hidden="true"></div>
          <div class="ui-sheet-head">
            {#if tuning}
              <button class="ui-round plain" onclick={() => (tuning = false)} aria-label="Назад"><Icon name="back" /></button>
            {:else}
              <button class="ui-round plain" onclick={() => (open = false)} aria-label="Закрыть"><Icon name="close" /></button>
            {/if}
            <b>{tuning ? 'Как отвечает ИИ' : 'Ответы своими словами'}</b>
            {@render gear()}
          </div>
          <div class="notif-scroll">{@render content()}</div>
        </div>
      </div>
    {:else}
      <button class="menu-scrim" aria-label="Закрыть" onclick={() => (open = false)}></button>
      <div class="menu notif-menu" role="dialog" aria-label="Ответы своими словами">
        <div class="notif-menu-head book-ai-head">
          {#if tuning}<button class="ui-round plain" onclick={() => (tuning = false)} aria-label="Назад"><Icon name="back" /></button>{/if}
          <span>{tuning ? 'Как отвечает ИИ' : 'Ответы своими словами'}</span>
          {@render gear()}
        </div>
        {@render content()}
      </div>
    {/if}
  {/if}
</div>
