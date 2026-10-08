<script>
  import { api } from '../lib/api.js';
  import { STATUS_NAMES } from '../lib/translation.svelte.js';

  /**
   * Hints under the translation editor: glossary warnings for the current text, glossary terms
   * of the fragment and its paragraph, and how the same wording was translated elsewhere.
   * @type {{ ref: string, start: number, end: number, text: string, proposalId?: number | null, onpick: (text: string) => void }}
   */
  let { ref, start, end, text, proposalId = null, onpick } = $props();

  /** @type {import('../lib/api.js').AssistResult | null} */
  let hints = $state(null);
  let seq = 0;
  let first = true; // not reactive: the first request goes out at once, later ones after a pause in typing

  // Re-check as the text changes (debounced); the terms and the memory depend on the fragment only.
  $effect(() => {
    const body = { ref, start, end, text, proposalId };
    const my = ++seq;
    const timer = setTimeout(() => {
      api.assist(body).then(
        (r) => my === seq && (hints = r),
        () => {},
      );
    }, first ? 0 : 400);
    first = false;
    return () => clearTimeout(timer);
  });
</script>

{#if hints && (hints.warnings.length || hints.terms.length || hints.memory.length)}
  <div class="assist">
    {#each hints.warnings as w (w.kind + w.termId + w.message)}
      <div class="gl-warning" role="status">{w.message}</div>
    {/each}
    {#if hints.terms.length}
      <div class="assist-block">
        <div class="assist-title">Термины глоссария</div>
        {#each hints.terms as t (t.id)}
          <div class="assist-term" title={t.note ?? ''}>
            <span lang="en">{t.en}</span> → <b>{t.ru}</b>
            {#if t.avoid.length}<span class="muted"> · не: {t.avoid.join(', ')}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if hints.memory.length}
      <div class="assist-block">
        <div class="assist-title">Уже переводили</div>
        {#each hints.memory as m (m.id)}
          <div class="assist-memory">
            <div class="assist-memory-head">
              <span class="muted small">{m.ref}</span>
              <span class="status-badge" data-status={m.status}>{STATUS_NAMES[m.status]}</span>
              {#if !m.exact}<span class="muted small">в составе фрагмента</span>{/if}
              <span class="spacer"></span>
              {#if m.exact}<button type="button" class="link-btn small" onclick={() => onpick(m.text)}>Подставить</button>{/if}
            </div>
            <div class="assist-memory-text"><del>{m.original}</del> → <ins>{m.text}</ins></div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
