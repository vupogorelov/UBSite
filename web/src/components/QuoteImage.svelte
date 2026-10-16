<script>
  import { quoteCard, closeQuoteCard } from '../lib/quotecard.svelte.js';
  import { drawQuoteCard, cardBlob, CARD_STYLES, CARD_FORMATS, QUOTE_PATH, QUOTE_BOX } from '../lib/quotecard.js';
  import { native } from '../lib/native.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { onBack } from '../lib/router.svelte.js';
  import { swipeClose } from '../lib/swipe.js';
  import { portal } from '../lib/portal.js';
  import Icon from './Icon.svelte';

  /**
   * «Картинка» of a quote: a preview, its background and format, and where it goes — the system's
   * «Поделиться» (a phone; in the Android app through its bridge), or copied / saved (a computer).
   */
  const src = $derived(quoteCard.source);

  const PREFS = 'ub.quoteCard';
  /** @returns {{ style: import('../lib/quotecard.js').CardStyle, format: import('../lib/quotecard.js').CardFormat }} */
  function readPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
      return { style: p.style in CARD_STYLES ? p.style : 'paper', format: p.format in CARD_FORMATS ? p.format : 'square' };
    } catch {
      return { style: 'paper', format: 'square' };
    }
  }
  const prefs = $state(readPrefs());
  $effect(() => {
    const p = JSON.stringify(prefs);
    try {
      localStorage.setItem(PREFS, p);
    } catch {}
  });

  /** @type {HTMLCanvasElement | undefined} */ let canvas = $state();
  let busy = $state(false);

  // the fonts: the reader's text font for the words, the interface's for the place
  const fontOf = (/** @type {string} */ v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || 'serif';
  $effect(() => {
    if (!src || !canvas) return;
    const o = { text: src.text, lang: src.lang, ref: src.ref, style: prefs.style, format: prefs.format, font: fontOf('--text-font'), sans: fontOf('--sans'), site: location.host };
    const c = canvas;
    // a web font (Geist, Roboto) is drawn only once it is loaded
    Promise.all([document.fonts.load(`400 48px ${o.font}`, o.text), document.fonts.load(`600 36px ${o.sans}`)])
      .catch(() => {})
      .then(() => drawQuoteCard(c, o));
  });

  $effect(() => {
    if (src) return onBack(() => void closeQuoteCard());
  });

  const name = $derived(src ? `urantia-${src.ref.replace(/[:.]/g, '-')}.png` : 'quote.png');
  const shareText = $derived(src ? `${src.lang === 'en' ? 'The Urantia Book' : 'Книга Урантии'}, ${src.ref}\n${src.link}` : '');
  // where it can go from here
  const bridge = /** @type {any} */ (native);
  const viaApp = typeof bridge?.shareImage === 'function';
  const canShareFile = !viaApp && typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] });
  // (copying a picture is for a computer: on a phone it goes by «Поделиться»)
  const canCopy = !viaApp && !matchMedia('(pointer: coarse)').matches && typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

  /** @param {() => Promise<void>} fn */
  async function act(fn) {
    if (!canvas || busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      if (/** @type {Error} */ (err).name !== 'AbortError') showToast(/** @type {Error} */ (err).message || 'Не получилось');
    } finally {
      busy = false;
    }
  }
  const share = () =>
    act(async () => {
      const c = /** @type {HTMLCanvasElement} */ (canvas);
      if (viaApp) {
        if (!bridge.shareImage(c.toDataURL('image/png').split(',')[1], name, shareText)) throw new Error('Не получилось поделиться');
        return;
      }
      const file = new File([await cardBlob(c)], name, { type: 'image/png' });
      await navigator.share({ files: [file], text: shareText });
    });
  const copy = () =>
    act(async () => {
      const blob = await cardBlob(/** @type {HTMLCanvasElement} */ (canvas));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Картинка скопирована');
    });
  const save = () =>
    act(async () => {
      const url = URL.createObjectURL(await cardBlob(/** @type {HTMLCanvasElement} */ (canvas)));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
</script>

{#if src}
  <div use:portal>
    <button class="sheet-scrim" aria-label="Закрыть" onclick={closeQuoteCard}></button>
    <div class="sheet ui-sheet qc-sheet" role="dialog" aria-label="Цитата-картинка" use:swipeClose={{ dirs: ['down'], onclose: closeQuoteCard }}>
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="ui-sheet-head">
        <button class="ui-round plain" onclick={closeQuoteCard} aria-label="Закрыть"><Icon name="close" /></button>
        <b>Цитата-картинка</b>
        <span></span>
      </div>
      <div class="qc-preview" class:story={prefs.format === 'story'}>
        <canvas bind:this={canvas} aria-label="«{src.text}» — {src.ref}"></canvas>
      </div>
      <div class="qc-options">
        <div class="qc-swatches" role="radiogroup" aria-label="Фон">
          {#each Object.entries(CARD_STYLES) as [id, s] (id)}
            <button class="qc-swatch" class:on={prefs.style === id} role="radio" aria-checked={prefs.style === id} title={s.name} aria-label={s.name}
              style:background="linear-gradient(160deg, {s.bg[0]}, {s.bg[1]})" style:color={s.accent}
              onclick={() => (prefs.style = /** @type {any} */ (id))}><svg viewBox={QUOTE_BOX} width="20" height="14" aria-hidden="true"><path d={QUOTE_PATH} fill="currentColor" /></svg></button>
          {/each}
        </div>
        <div class="ui-chips qc-formats" role="radiogroup" aria-label="Формат">
          {#each Object.entries(CARD_FORMATS) as [id, f] (id)}
            <button class="ui-chip" class:on={prefs.format === id} role="radio" aria-checked={prefs.format === id}
              onclick={() => (prefs.format = /** @type {any} */ (id))}>{f.name}</button>
          {/each}
        </div>
      </div>
      <div class="qc-actions">
        {#if viaApp || canShareFile}
          <button class="ui-btn primary" disabled={busy} onclick={share}><Icon name="share" size={18} />Поделиться</button>
        {/if}
        {#if canCopy}
          <button class="ui-btn" class:primary={!canShareFile} disabled={busy} onclick={copy}><Icon name="copy" size={18} />Копировать</button>
        {/if}
        {#if !viaApp}
          <button class="ui-btn" disabled={busy} onclick={save}><Icon name="download" size={18} />Сохранить</button>
        {/if}
      </div>
    </div>
  </div>
{/if}
