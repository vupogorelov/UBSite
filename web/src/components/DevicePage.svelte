<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from '../lib/api.js';
  import { offline, offlinePossible, megabytes, bytesText } from '../lib/offline.svelte.js';
  import { outbox, describe, retry, discard } from '../lib/outbox.svelte.js';
  import { recordingList, loadRecordings } from '../lib/tts.svelte.js';
  import { NARRATORS } from '../lib/voice-choice.js';
  import { rec, download, pause, resume, cancel, removeFiles, keptBytes, allKept, setKeepListened, freeListened, loadKept } from '../lib/recordings.svelte.js';
  import { plural } from '../lib/format.js';
  import { feedReady, pull } from '../lib/feed.js';
  import { allNotes } from '../lib/notes.svelte.js';
  import { formatBookExport } from '../lib/book-export.js';
  import { native } from '../lib/native.js';
  import Icon from './Icon.svelte';

  /**
   * Settings → «Память»: everything kept on this device, in one place (VISION.md, 10: the service
   * side, quietly). The book is prepared by itself; the narrator's recording is the one thing chosen —
   * by paper, part or whole, its size told beforehand, the download shown with pause and cancel.
   */

  let toc = $state(/** @type {import('../lib/api.js').Toc | null} */ (null));
  let exportMode = $state(/** @type {'bilingual' | 'russian'} */ ('bilingual'));
  let includeNotes = $state(false);
  let exporting = $state(false);
  let exportError = $state('');
  let exportProgress = $state(0);
  let exportStage = $state('');
  onMount(() => {
    api.toc().then((t) => (toc = t), () => {});
    loadRecordings();
    void loadKept();
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

  /** @typedef {import('../lib/recordings.svelte.js').AudioFile} AudioFile */
  const langs = $derived(Object.keys(recordingList).filter((l) => recordingList[l]?.length));
  /** The files of a language, of some papers (all: null). @param {string} lang @param {Set<number> | null} papers @returns {AudioFile[]} */
  const filesOf = (lang, papers) =>
    (recordingList[lang] ?? []).filter((t) => !papers || papers.has(t.paper)).map((t) => ({ lang, file: t.file, size: t.size ?? 0 }));
  const sum = (/** @type {AudioFile[]} */ fs) => fs.reduce((s, f) => s + f.size, 0);
  /** The parts with their papers (from the contents). */
  const parts = $derived(
    toc
      ? toc.parts.map((p) => ({ id: p.id, title: p.titleRu, papers: toc ? toc.papers.filter((x) => x.partId === p.id) : [] })).filter((p) => p.papers.length)
      : [],
  );
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
  /** Parts opened down to their papers: "lang:part". */
  const opened = new SvelteSet();
  /** Room left on the device (as the browser offers it). */
  const room = $derived(rec.quota ? Math.max(0, rec.quota - rec.usage) : Infinity);
  const job = $derived(rec.job);
  const failed = $derived(outbox.items.filter((o) => o.state === 'failed'));
</script>

{#snippet files(/** @type {string} */ label, /** @type {AudioFile[]} */ fs, /** @type {boolean} */ big)}
  {@const total = sum(fs)}
  {@const kept = keptBytes(fs)}
  {@const all = allKept(fs)}
  {@const left = total - kept}
  {#if all}
    <button class="link-btn small dev-act" onclick={() => removeFiles(fs)}>Удалить</button>
  {:else if left > room}
    <span class="muted small dev-act">Не хватит места</span>
  {:else}
    <button class="ui-btn small dev-act" onclick={() => download(label, fs)} disabled={!navigator.onLine} title={big ? 'Скачать на устройство' : 'Скачать Текст'}>
      <Icon name="cloud-download" size={15} />{bytesText(left)}</button>
  {/if}
{/snippet}

<!-- the book: by itself -->
<div class="set-section">Книга</div>
<div class="set-list">
  <div class="set-row set-row-static">
    <span class="ui-tile set-row-icon"><Icon name="book-open" size={18} /></span>
    <span class="set-row-text">
      <b>Книга и поиск без сети</b>
      <span class="muted small">
        {#if !offlinePossible}Этот браузер не умеет хранить книгу{:else if offline.state === 'ready'}Сохранены сами · {megabytes(offline.bytes)}{offline.searchReady ? '' : ' · поиск готовится'}{:else if offline.state === 'loading'}Сохраняется · {megabytes(offline.bytes)} из {megabytes(offline.total)}{:else if offline.state === 'waiting'}Сохранится, когда появится связь{:else}Готовится…{/if}
      </span>
      {#if offline.state === 'loading'}<span class="set-progress"><span style:width="{(offline.bytes / (offline.total || 1)) * 100}%"></span></span>{/if}
    </span>
    <span class="set-row-end">{#if offline.state === 'ready'}<Icon name="check" size={18} />{/if}</span>
  </div>
</div>

<div class="set-section">Экспорт книги</div>
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
    <button class="ui-btn small dev-act" onclick={exportBook} disabled={exporting}>
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

<!-- the narrator's recording: by choice -->
{#each langs as lang (lang)}
  {@const everything = filesOf(lang, null)}
  <div class="set-section">Запись · {NARRATORS[lang] ?? lang}</div>
  <div class="set-list">
    <div class="set-row set-row-static">
      <span class="ui-tile set-row-icon"><Icon name="headphones" size={18} /></span>
      <span class="set-row-text">
        <b>Вся запись</b>
        <span class="muted small">{bytesText(sum(everything))}{keptBytes(everything) ? ` · сохранено ${bytesText(keptBytes(everything))}` : ' · много места — можно по Частям'}</span>
      </span>
      {@render files(`Вся запись · ${NARRATORS[lang] ?? lang}`, everything, true)}
    </div>
    {#each parts as p (p.id)}
      {@const fs = filesOf(lang, new Set(p.papers.map((x) => x.id)))}
      {@const k = `${lang}:${p.id}`}
      {#if fs.length}
        <div class="set-row set-row-static dev-part">
          <button class="dev-open" onclick={() => (opened.has(k) ? opened.delete(k) : opened.add(k))} aria-expanded={opened.has(k)}>
            <span class="set-row-text">
              <b>Часть {ROMAN[p.id] ?? p.id}</b>
              <span class="muted small ellipsis">{bytesText(sum(fs))}{keptBytes(fs) ? ` · сохранено ${bytesText(keptBytes(fs))}` : ''} · {p.papers.length} {plural(p.papers.length, 'Текст', 'Текста', 'Текстов')}</span>
            </span>
            <Icon name={opened.has(k) ? 'up' : 'down'} size={16} />
          </button>
          {@render files(`Часть ${ROMAN[p.id] ?? p.id}`, fs, true)}
        </div>
        {#if opened.has(k)}
          {#each p.papers as paper (paper.id)}
            {@const pf = filesOf(lang, new Set([paper.id]))}
            {#if pf.length}
              <div class="set-row set-row-static dev-paper">
                <span class="set-row-text">
                  <b class="ellipsis">{paper.id === 0 ? 'Предисловие' : `Текст ${paper.id}`}</b>
                  <span class="muted small ellipsis">{paper.id === 0 ? '' : `${paper.titleRu} · `}{bytesText(sum(pf))}</span>
                </span>
                {@render files(paper.id === 0 ? 'Предисловие' : `Текст ${paper.id}`, pf, false)}
              </div>
            {/if}
          {/each}
        {/if}
      {/if}
    {/each}
  </div>
{/each}

{#if job}
  <!-- the download: what, how far, pause / go on / cancel -->
  <div class="dev-job" role="status">
    <div class="dev-job-head">
      <b class="ellipsis">{job.label}</b>
      <span class="muted small">{Math.round(((job.bytes + job.fileBytes) / (job.total || 1)) * 100)} %</span>
    </div>
    <span class="set-progress"><span style:width="{((job.bytes + job.fileBytes) / (job.total || 1)) * 100}%"></span></span>
    <span class="muted small">{bytesText(job.bytes + job.fileBytes)} из {bytesText(job.total)} · файл {Math.min(job.done + 1, job.files.length)} из {job.files.length}</span>
    {#if job.error}<span class="small dev-job-error">{job.error}</span>{/if}
    <div class="dev-job-actions">
      {#if job.paused}<button class="ui-btn small primary" onclick={resume}>Продолжить</button>
      {:else}<button class="ui-btn small" onclick={pause}>Пауза</button>{/if}
      <button class="link-btn small" onclick={() => cancel(false)}>Отменить</button>
      {#if job.made.length}<button class="link-btn small" onclick={() => cancel(true)}>Отменить и удалить скачанное</button>{/if}
    </div>
  </div>
{/if}

{#if langs.length}
  <div class="set-section">Прослушанное</div>
  <div class="set-list">
    <label class="set-row set-row-static dev-switch">
      <span class="set-row-text">
        <b>Сохранять прослушанное</b>
        <span class="muted small">{rec.listened.length
          ? `Сохранено ${rec.listened.length} ${plural(rec.listened.length, 'файл', 'файла', 'файлов')} · ${bytesText(rec.listened.reduce((s, k) => s + (rec.saved[k] ?? 0), 0))}`
          : 'Файлы записи, которые вы слушали, останутся на устройстве и будут звучать без сети'}</span>
      </span>
      <input type="checkbox" class="ui-switch" checked={rec.keepListened} onchange={(e) => setKeepListened(e.currentTarget.checked)} />
    </label>
    {#if rec.listened.length}
      <div class="set-row set-row-static"><span class="set-row-text"></span><button class="link-btn small dev-act" onclick={freeListened}>Освободить</button></div>
    {/if}
  </div>
{/if}

{#if outbox.items.length}
  <!-- what waits to be sent (shown only while something does) -->
  <div class="set-section">Ждут отправки</div>
  <div class="set-list">
    <div class="set-row set-row-static">
      <span class="ui-tile set-row-icon"><Icon name={failed.length ? 'alert' : 'clock'} size={18} /></span>
      <span class="set-row-text">
        <b>{outbox.items.length} {plural(outbox.items.length, 'изменение', 'изменения', 'изменений')}</b>
        <span class="muted small">{failed.length ? `не принято: ${failed.length}` : 'отправятся, когда будет связь'}</span>
        {#each failed as op (op.id)}
          <span class="set-failed small">
            <span class="ellipsis">{describe(op)}{op.error ? ` — ${op.error}` : ''}</span>
            <button class="link-btn small" onclick={() => retry(op)}>Повторить</button>
            <button class="link-btn small" onclick={() => discard(op)}>Удалить</button>
          </span>
        {/each}
      </span>
    </div>
  </div>
{/if}

{#if rec.usage}
  <p class="ui-hint dev-usage">Всего занято на этом устройстве: {bytesText(rec.usage)}{rec.quota ? ` · свободно ещё около ${bytesText(Math.max(0, rec.quota - rec.usage))}` : ''}.</p>
{/if}
