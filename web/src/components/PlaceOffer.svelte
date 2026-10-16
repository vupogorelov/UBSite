<script>
  import { places, placePath } from '../lib/places.svelte.js';
  import { navigate } from '../lib/router.svelte.js';
  import Icon from './Icon.svelte';

  /** "On your phone you stopped at 86:5.4 — Go": the reading place left on another device. */
  const p = $derived(places.elsewhere);
  const where = $derived(p ? (p.key.includes(':') ? p.key : `Текст ${p.paper}`) : '');

  // It goes away by itself after a while: it is an offer, not a question.
  $effect(() => {
    if (!p) return;
    const t = setTimeout(() => (places.elsewhere = null), 20_000);
    return () => clearTimeout(t);
  });

  function go() {
    if (p) navigate(placePath(p));
    places.elsewhere = null;
  }
</script>

{#if p}
  <div class="place-offer" role="status">
    <span class="place-offer-text">На {p.deviceKind === 'phone' ? 'телефоне' : 'компьютере'} вы остановились на <b>{where}</b></span>
    <button class="btn primary" onclick={go}>Перейти</button>
    <button class="icon-btn small-btn" onclick={() => (places.elsewhere = null)} aria-label="Скрыть" title="Скрыть"><Icon name="close" /></button>
  </div>
{/if}
