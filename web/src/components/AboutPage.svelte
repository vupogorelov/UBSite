<script>
  import { onMount, tick } from 'svelte';
  import { api, shown } from '../lib/api.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import { navigate } from '../lib/router.svelte.js';
  import Icon from './Icon.svelte';
  import { native } from '../lib/native.js';
  import { version, appUpdate, install, checkVersion } from '../lib/version.svelte.js';

  /**
   * "О приложении" (/about): the project's about.md, rendered like a README on GitHub. Its title and
   * opening words stay open; each section (a "##" heading and what follows) folds — one open at a time.
   */

  let intro = $state('');
  /** @type {{ title: string, html: string }[]} */
  let parts = $state([]);
  let open = $state(-1);
  let error = $state('');
  /** @type {HTMLElement[]} */
  const heads = [];
  onMount(() => {
    if (native) void checkVersion(); // (the newest Android app, for the version below)
    // "about/x.webp" in about.md → /api/about/x.webp; the copy first, the network's answer over it
    let last = '';
    shown(api.about(), (r) => r.markdown !== last && ((last = r.markdown), split(renderMarkdown(r.markdown, '/api/')))).catch(
      (err) => (error = err.message),
    );
  });

  /** The rendered page cut at its "##" headings. @param {string} html */
  function split(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    let box = document.createElement('div');
    /** @type {{ title: string, box: HTMLElement }[]} */
    const out = [];
    const first = box;
    for (const n of [...t.content.childNodes]) {
      if (n.nodeName === 'H2') {
        box = document.createElement('div');
        out.push({ title: n.textContent ?? '', box });
      } else box.append(n);
    }
    intro = first.innerHTML;
    parts = out.map((p) => ({ title: p.title, html: p.box.innerHTML }));
  }

  /** @param {number} i */
  async function toggle(i) {
    open = open === i ? -1 : i;
    if (open !== i) return;
    await tick(); // the others folded: the opened one's heading may have gone up off the screen
    heads[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Links to app pages ("/5:1.3") open in the app; others in a new tab (set by the renderer). @param {MouseEvent} e */
  function onClick(e) {
    const href = /** @type {HTMLElement} */ (e.target).closest('a')?.getAttribute('href');
    if (!href?.startsWith('/') || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
  }
</script>

<div class="about-page">
  {#if error}
    <p class="muted pad">{error}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <article class="markdown-body" onclick={onClick}>
      {@html intro}
      <!-- the changes by date (features/whatsnew) -->
      <a class="ui-card about-news" href="/whatsnew">
        <span class="ui-tile"><Icon name="star" size={18} /></span>
        <span class="about-news-text"><b>Что нового</b><span class="muted small">Изменения платформы по датам, свежие сверху</span></span>
        <Icon name="chevron" size={16} />
      </a>
      {#each parts as p, i (i)}
        <section class="about-part" class:open={open === i}>
          <h2 bind:this={heads[i]}>
            <button class="about-head" aria-expanded={open === i} aria-controls="about-{i}" onclick={() => toggle(i)}>
              <span>{p.title}</span><Icon name={open === i ? 'up' : 'down'} size={20} />
            </button>
          </h2>
          {#if open === i}<div class="about-body" id="about-{i}">{@html p.html}</div>{/if}
        </section>
      {/each}
      {#if native}
        <!-- the Android app's version; reinstalling it by hand (an update comes to the bell by itself) -->
        <div class="ui-card about-app">
          <span class="ui-tile"><Icon name="cloud-download" size={18} /></span>
          <span class="about-news-text">
            <b>Приложение для Android {version.app.installed}</b>
            <span class="muted small">{appUpdate() ? `Есть версия ${version.app.latest}` : version.app.latest ? 'Последняя версия' : 'Версия на устройстве'}</span>
          </span>
          <button class="ui-chip" onclick={install}>Переустановить</button>
        </div>
      {/if}
    </article>
  {/if}
</div>
