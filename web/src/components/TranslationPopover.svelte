<script>
  import { openThread } from '../lib/translation.svelte.js';
  import ProposalCard from './ProposalCard.svelte';
  import Icon from './Icon.svelte';

  /**
   * Translation variants of the fragment under the pointer (Ctrl+click / tap on a marked fragment).
   * `original`: the fragment shows the reader's own variant in place of the text, so the original
   * wording is what they came for and is shown prominently.
   * @type {{
   *   x: number, y: number, below: boolean, original: boolean,
   *   items: import('../lib/api.js').Proposal[],
   *   fragment: import('../lib/translation.svelte.js').Fragment,
   *   onclose: () => void,
   * }}
   */
  let { x, y, below, original, items, fragment, onclose } = $props();
  /** «Предложить свой вариант»: the fragment is taken before closing (closing drops the props). */
  function propose() {
    const f = fragment;
    onclose();
    openThread(f.ref, { compose: f });
  }
</script>

<!-- (phone: the variants are a sheet from the bottom, over a dimmed page) -->
<button class="sheet-scrim tr-pop-scrim" aria-label="Закрыть" onclick={onclose}></button>
<div class="tr-popover" class:below style:left="{x}px" style:top="{y}px" role="dialog" aria-label="Варианты перевода">
  <div class="tr-popover-head">
    <b>{original ? 'Исходный текст' : 'Варианты перевода'}</b>
    <button class="ui-round plain small" aria-label="Закрыть" onclick={onclose}><Icon name="close" size={18} /></button>
  </div>
  {#if original}
    <div class="tr-original-big">{fragment.original}</div>
    <div class="ui-label">Варианты</div>
  {:else}
    <div class="tr-original">Оригинал: «{fragment.original}»</div>
  {/if}
  {#each items as p (p.id)}
    <ProposalCard {p} compact />
  {/each}
  <button class="ui-btn tr-propose" onclick={propose}><Icon name="edit" size={16} />Предложить свой вариант</button>
</div>
