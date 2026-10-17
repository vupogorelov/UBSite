<script>
  import { navigate } from '../../lib/router.svelte.js';
  import { session } from '../../lib/session.svelte.js';
  import { book } from '../../lib/lang.svelte.js';
  import { whatIs, closeWhatIs } from './whatis.svelte.js';
  import { kindName } from './api.js';
  import Icon from '../../components/Icon.svelte';

  /**
   * «Что это?» over the text: the article of the selected words — its kind, names, what it is in a few
   * words, the way to the whole of it. None — said so; a coordinator is offered to write it.
   */
  const coordinator = $derived(!!session.user && (session.user.isCoordinator || session.user.isAdmin));

  /** @param {string} path */
  function go(path) {
    closeWhatIs();
    navigate(path);
  }
</script>

{#if whatIs.open}
  <button class="sheet-scrim" aria-label="Закрыть" onclick={closeWhatIs}></button>
  <div class="sheet whatis" role="dialog" aria-labelledby="whatis-title">
    <div class="sheet-grip" aria-hidden="true"></div>
    {#if whatIs.loading}
      <p class="muted" id="whatis-title">Ищу в словаре книги…</p>
    {:else if whatIs.found}
      {@const f = whatIs.found}
      <div class="whatis-head">
        <span class="whatis-kind">{kindName(f.kind)}</span>
        <b id="whatis-title" class="whatis-name">{book.main === 'en' && f.nameEn ? f.nameEn : f.nameRu}</b>
        {#if f.nameEn && book.main !== 'en'}<span class="muted" lang="en">{f.nameEn}</span>{/if}
      </div>
      {@const brief = book.main === 'en' && f.briefEn ? f.briefEn : f.briefRu}
      {#if brief}<p class="whatis-brief">{brief}</p>{:else}<p class="muted">Описание ещё пишется.</p>{/if}
      <div class="whatis-actions">
        <button class="ui-btn primary" onclick={() => go(`/d/${f.id}`)}>Подробнее<Icon name="chevron" size={16} /></button>
        <button class="ui-btn" onclick={closeWhatIs}>Закрыть</button>
      </div>
    {:else}
      <b id="whatis-title" class="whatis-name">«{whatIs.text}»</b>
      <p class="muted">{whatIs.error || 'В словаре книги об этом пока нет статьи.'}</p>
      <div class="whatis-actions">
        {#if coordinator && !whatIs.error}<button class="ui-btn primary" onclick={() => go(`/d?q=${encodeURIComponent(whatIs.text)}`)}>Написать статью</button>{/if}
        <button class="ui-btn" onclick={() => go('/d')}>Весь словарь</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .whatis {
    max-width: 520px;
    margin: 0 auto;
  }
  .whatis-head {
    display: grid;
    gap: 2px;
  }
  .whatis-kind {
    color: var(--muted);
    font: 500 12px/16px var(--sans);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .whatis-name {
    font: 600 20px/26px var(--sans);
  }
  .whatis-brief {
    margin: 0;
    font: 16px/1.55 var(--text-font, var(--serif));
  }
  .whatis p {
    margin: 0;
  }
  .whatis-actions {
    display: flex;
    gap: var(--space-2);
  }
  .whatis-actions .ui-btn {
    flex: 1;
  }
</style>
