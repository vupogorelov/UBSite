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
</script>

<div class="tr-popover" class:below style:left="{x}px" style:top="{y}px" role="dialog" aria-label="Варианты перевода">
  <div class="tr-popover-head">
    <span class="box-title">{original ? 'Исходный текст' : 'Варианты перевода'}</span>
    <button class="icon-btn small-btn" aria-label="Закрыть" onclick={onclose}><Icon name="close" /></button>
  </div>
  {#if original}
    <div class="tr-original-big">{fragment.original}</div>
    <div class="box-title">Варианты</div>
  {:else}
    <div class="tr-original">Оригинал: «{fragment.original}»</div>
  {/if}
  {#each items as p (p.id)}
    <ProposalCard {p} compact />
  {/each}
  <button class="btn wide" onclick={() => (onclose(), openThread(fragment.ref, { compose: fragment }))}>Предложить свой вариант</button>
</div>
