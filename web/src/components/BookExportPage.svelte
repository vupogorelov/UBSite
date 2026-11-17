<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { feedReady, pull } from '../lib/feed.js';
  import { allNotes } from '../lib/notes.svelte.js';
  import { formatBookExport } from '../lib/book-export.js';
  import { native } from '../lib/native.js';
  import Icon from './Icon.svelte';

  let toc = $state(/** @type {import('../lib/api.js').Toc | null} */ (null));
  let exportMode = $state(/** @type {'bilingual' | 'russian'} */ ('bilingual'));
  let includeNotes = $state(false);
  let exporting = $state(false);
  let exportError = $state('');
  let exportProgress = $state(0);
  let exportStage = $state('');

  onMount(() => {
    api.toc().then((t) => (toc = t), (error) => (exportError = error instanceof Error ? error.message : String(error)));
  });

  /** @param {string} html @param {boolean} markdown */
  function paragraphText(html, markdown) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    /** @param {Node} node @returns {string} */
    const textOf = (node) => {
      if (node.nodeType === 3) return node.nodeValue ?? '';
      if (node.nodeType !== 1) return '';
      const el = /** @type {Element} */ (node);
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      const inner = [...el.childNodes].map(textOf).join('');
      return markdown && (tag === 'i' || tag === 'em') ? `*${inner}*` : inner;
    };
    return [...doc.body.childNodes]
      .map(textOf)
      .join('')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  /** @param {string} text */
  function base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function exportBook() {
    if (exporting) return;
    exporting = true;
    exportError = '';
    exportProgress = 0;
    exportStage = 'Загружаем книгу';
    try {
      const contents = toc ?? (await api.toc());
      toc = contents;
      const papers = [];
      for (const paper of contents.papers) {
        const data = await api.paper(paper.id);
        papers.push({
          paper: data.paper,
          sections: data.sections,
          paragraphs: data.paragraphs.map((p) => ({
            ...p,
            ru: paragraphText(p.ru, true),
            en: paragraphText(p.en, true),
            cleanRu: paragraphText(p.ru, false),
          })),
        });
        exportProgress++;
      }

      /** @type {import('../lib/api.js').Note[]} */
      let notes = [];
      /** @type {{ ref: string, authorName: string | null, body: string }[]} */
      let comments = [];
      if (includeNotes && exportMode === 'bilingual') {
        exportStage = 'Загружаем заметки и комментарии';
        await feedReady();
        await pull();
        notes = allNotes();
        comments = (await api.bookComments()).comments;
      }

      const body = formatBookExport({
        toc: contents,
        papers,
        notes,
        comments,
        includeNotes: includeNotes && exportMode === 'bilingual',
        russianOnly: exportMode === 'russian',
      });
      const filename = exportMode === 'russian' ? 'Книга Урантии — русский для озвучки.txt' : 'Книга Урантии.md';
      const mime = exportMode === 'russian' ? 'text/plain' : 'text/markdown';
      if (native?.shareFile) {
        if (!native.shareFile(base64(body), filename, mime)) throw new Error('Не удалось открыть меню сохранения Android');
      } else {
        const url = URL.createObjectURL(new Blob([body], { type: `${mime};charset=utf-8` }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      exportError = error instanceof Error ? error.message : String(error);
    } finally {
      exporting = false;
      exportStage = '';
    }
  }
</script>

<div class="set-section">Формат книги</div>
<div class="set-list">
  <div class="set-row set-row-static dev-export-format">
    <span class="set-row-text">
      <b>Вариант текста</b>
      <span class="muted small">Русский и английский или чистый русский для озвучки</span>
    </span>
  </div>
  <div class="set-row set-row-static dev-export-choice">
    <div class="ui-chips set-chips" role="radiogroup" aria-label="Вариант экспорта">
      <button class="ui-chip" class:on={exportMode === 'bilingual'} role="radio" aria-checked={exportMode === 'bilingual'}
        disabled={exporting} onclick={() => (exportMode = 'bilingual')}>Русский + English</button>
      <button class="ui-chip" class:on={exportMode === 'russian'} role="radio" aria-checked={exportMode === 'russian'}
        disabled={exporting} onclick={() => (exportMode = 'russian')}>Для озвучки</button>
    </div>
  </div>
  {#if exportMode === 'bilingual'}
    <label class="set-row set-row-static dev-switch">
      <span class="set-row-text">
        <b>Добавить заметки и комментарии</b>
        <span class="muted small">После русского и английского текста каждого абзаца</span>
      </span>
      <input type="checkbox" class="ui-switch" bind:checked={includeNotes} disabled={exporting} />
    </label>
  {:else}
    <div class="set-row set-row-static">
      <span class="set-row-text muted small">Без номеров, перевода, заметок и комментариев · TXT</span>
    </div>
  {/if}
  <div class="set-row set-row-static dev-export-action">
    <span class="set-row-text">
      <b>{exportMode === 'russian' ? 'Книга Урантии · TXT' : 'Книга Урантии · Markdown'}</b>
      {#if exporting}<span class="muted small" role="status">{exportStage || `Подготовлено ${exportProgress} из ${toc?.papers.length ?? '…'} Текстов`}</span>{/if}
    </span>
    <button class="ui-btn small dev-act" onclick={exportBook} disabled={exporting || !toc}>
      <Icon name="cloud-download" size={15} />{exporting ? 'Готовим…' : 'Экспортировать'}
    </button>
  </div>
  {#if exporting}
    <div class="dev-export-progress" role="progressbar" aria-label="Подготовка экспорта"
      aria-valuemin="0" aria-valuemax={toc?.papers.length ?? 197} aria-valuenow={exportProgress}>
      <span style:width="{toc?.papers.length ? (exportProgress / toc.papers.length) * 100 : 0}%"></span>
    </div>
  {/if}
  {#if exportError}
    <p class="ui-hint dev-export-error" role="alert">Не удалось экспортировать книгу: {exportError}</p>
  {/if}
</div>
