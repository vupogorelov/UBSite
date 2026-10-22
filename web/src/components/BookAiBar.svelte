<script>
  import { onMount } from 'svelte';
  import { myAi, loadMyAi, connectMyAi, disconnectMyAi } from '../lib/ai.svelte.js';

  /**
   * «Я и Книга», over the field: who writes the Book's own words — the reader's own AI, or the application's shared
   * answers (how many are left today); when there are none — the way to connect one's own. Honest about it: the
   * question and the paragraphs go to an outside AI (VISION.md, 5). `answers`: the Book's answers so far (one more —
   * the count is read again).
   * @type {{ answers: number }}
   */
  let { answers } = $props();

  onMount(loadMyAi);
  let seen = -1;
  $effect(() => {
    if (seen !== -1 && answers !== seen) loadMyAi();
    seen = answers;
  });

  const s = $derived(myAi.state);
</script>

{#if s}
  <p class="book-ai-bar" title="Вопрос и найденные абзацы получает внешний ИИ (OpenRouter); ответ проверяется по абзацам под ним">
    {#if s.own}
      Своими словами отвечает ваш ИИ · {s.own.title}
      <button class="link-btn" onclick={disconnectMyAi}>Отключить</button>
    {:else if s.shared && s.shared.left > 0}
      Ответов своими словами сегодня: {s.shared.left} из {s.shared.of} · внешний ИИ
      <button class="link-btn" onclick={connectMyAi}>Подключить свой ИИ</button>
    {:else}
      <span>{s.shared ? 'Общие ответы своими словами на сегодня закончились — Книга отвечает абзацами.' : 'Книга отвечает абзацами.'}</span>
      <button class="link-btn strong" onclick={connectMyAi}>Подключить свой ИИ</button>
      <span>— бесплатно, вход через OpenRouter</span>
    {/if}
  </p>
{/if}
