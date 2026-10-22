<script>
  import { untrack } from 'svelte';
  import { navigate, route } from '../../lib/router.svelte.js';
  import { session } from '../../lib/session.svelte.js';
  import { book } from '../../lib/lang.svelte.js';
  import { plural, paperLabel } from '../../lib/format.js';
  import { renderBody } from '../../lib/markup.js';
  import { showToast } from '../../lib/toast.svelte.js';
  import { api, shown } from '../../lib/api.js';
  import { discussInChat } from '../../lib/chat.svelte.js';
  import { askLogin } from '../../lib/guest.svelte.js';
  import { dictApi, KINDS, kindName } from './api.js';
  import Icon from '../../components/Icon.svelte';

  /**
   * An article of the dictionary (/d/12): what it is in a few words and in full, its main places in the
   * text, the related articles, every paragraph that names it (by paper). A coordinator writes it here:
   * «Править» (or /d/12?edit=1, as a new one opens) — the kind, the names, the descriptions in both
   * languages, the main places (the hints: the first mention, what says what it is), the related ones.
   * @type {{ id: number }}
   */
  let { id } = $props();

  const coordinator = $derived(!!session.user && (session.user.isCoordinator || session.user.isAdmin));
  let a = $state(/** @type {import('./api.js').Article | null} */ (null));
  let error = $state('');
  let editing = $state(false);
  let allPapers = $state(false);

  $effect(() => {
    const current = id;
    a = null;
    error = '';
    // (the copy first, the network's answer over it — the editing begun once)
    let begun = false;
    const drafts = coordinator;
    untrack(() => shown(dictApi.get(current, drafts), (r) => {
      if (id !== current) return;
      a = r;
      if (begun || editing) return;
      begun = true;
      editing = coordinator && new URLSearchParams(route.path.split('?')[1] ?? '').get('edit') === '1';
      if (editing) startEdit(r);
    }).catch((e) => id === current && (error = e.message)));
  });

  /** How many messages its discussion has (null — not known). */
  let messages = $state(/** @type {number | null} */ (null));
  $effect(() => {
    const current = id;
    messages = null;
    shown(dictApi.discussion(current), (r) => id === current && (messages = r.messages)).catch(() => {});
  });
  function discuss() {
    if (!session.user) return askLogin('обсуждение');
    discussInChat(`dict:${id}`);
  }

  const en = $derived(book.main === 'en');
  const name = $derived(a ? (en && a.nameEn ? a.nameEn : a.nameRu) : '');
  const brief = $derived(a ? (en && a.briefEn ? a.briefEn : a.briefRu) : '');
  const body = $derived(a ? (en && a.bodyEn ? a.bodyEn : a.bodyRu) : '');
  const LINK_NAMES = /** @type {Record<string, string>} */ ({ part: 'часть', belongs: 'принадлежит', related: 'связано' });

  /** Links inside the text to the book ("5:1.3") open in the app. @param {MouseEvent} e */
  function onTextClick(e) {
    const link = /** @type {HTMLElement} */ (e.target).closest('a[data-internal]');
    if (!link) return;
    e.preventDefault();
    navigate(/** @type {string} */ (link.getAttribute('href')));
  }

  // ---- Writing (a coordinator) ----
  let draft = $state({ kind: /** @type {import('./api.js').Kind} */ ('concept'), nameRu: '', nameEn: '', briefRu: '', briefEn: '', bodyRu: '', bodyEn: '' });
  let saving = $state(false);
  let hints = $state(/** @type {import('./api.js').Hint[] | null} */ (null));
  let glossary = $state(/** @type {{ id: number, ru: string, en: string }[] | null} */ (null));
  let others = $state(/** @type {import('./api.js').ArticleItem[] | null} */ (null));
  let nameQuery = $state('');
  let linkQuery = $state('');
  let refToAdd = $state('');
  let confirmDelete = $state(false);

  /** @param {import('./api.js').Article} r */
  function startEdit(r) {
    draft = { kind: r.kind, nameRu: r.nameRu, nameEn: r.nameEn, briefRu: r.briefRu, briefEn: r.briefEn, bodyRu: r.bodyRu, bodyEn: r.bodyEn };
    editing = true;
    dictApi.hints(r.id).then((h) => (hints = h), () => (hints = []));
    if (!glossary) api.glossary().then((g) => (glossary = g), () => (glossary = []));
    if (!others) dictApi.list(true).then((l) => (others = l), () => (others = []));
  }
  /** @param {() => Promise<import('./api.js').Article>} call */
  async function change(call) {
    saving = true;
    try {
      a = await call();
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    } finally {
      saving = false;
    }
  }
  const save = () => change(() => dictApi.update(id, draft)).then(() => showToast('Сохранено'));
  /** @param {'draft' | 'published'} status */
  const setStatus = (status) => change(() => dictApi.update(id, { ...draft, status }));
  /** @param {number[]} ids */
  const setNames = (ids) => change(() => dictApi.setNames(id, ids));
  /** @param {{ ref: string, note: string }[]} places */
  const setPlaces = (places) => change(() => dictApi.setPlaces(id, places));
  /** @param {{ id: number, kind: string }[]} links */
  const setLinks = (links) => change(() => dictApi.setLinks(id, links));
  const places = $derived(a ? a.places.map((p) => ({ ref: p.ref, note: p.note })) : []);
  /** @param {number} i @param {-1 | 1} dir */
  function movePlace(i, dir) {
    const list = [...places];
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    void setPlaces(list);
  }
  const low = (/** @type {string} */ s) => s.toLocaleLowerCase('ru');
  const nameOptions = $derived(
    !glossary || !nameQuery.trim() ? [] : glossary.filter((g) => !a?.names.some((n) => n.id === g.id) && (low(g.ru).includes(low(nameQuery)) || low(g.en).includes(low(nameQuery)))).slice(0, 8),
  );
  const linkOptions = $derived(
    !others || !linkQuery.trim() ? [] : others.filter((o) => o.id !== id && !a?.links.some((l) => l.id === o.id) && (low(o.nameRu).includes(low(linkQuery)) || low(o.nameEn).includes(low(linkQuery)))).slice(0, 8),
  );
  async function remove() {
    if (!confirmDelete) return void (confirmDelete = true);
    try {
      await dictApi.remove(id);
      navigate('/d');
    } catch (e) {
      showToast(/** @type {Error} */ (e).message);
    }
  }
</script>

<div class="dict-page">
  <div class="dict-inner">
    <button class="link-btn dict-back" onclick={() => navigate('/d')}><Icon name="back" size={16} />Словарь</button>
    {#if error}
      <p class="muted">{error}</p>
    {:else if !a}
      <p class="muted">Загрузка…</p>
    {:else}
      <header class="art-head">
        <span class="art-kind">{kindName(a.kind)}{#if a.status === 'draft'}{' · '}<span class="art-draft">черновик</span>{/if}</span>
        <h1 class="art-name">{name}</h1>
        {#if a.nameEn && !en}<span class="muted art-en" lang="en">{a.nameEn}</span>{/if}
        {#if coordinator && !editing}
          <div class="art-tools">
            <button class="ui-btn small" onclick={() => a && startEdit(a)}><Icon name="edit" size={15} />Править</button>
            {#if a.status === 'draft'}<button class="ui-btn small primary" onclick={() => setStatus('published')} disabled={saving}>Опубликовать</button>{/if}
          </div>
        {/if}
      </header>

      {#if editing}
        <!-- ---- the coordinator's writing ---- -->
        <section class="art-edit" aria-label="Правка статьи">
          <div class="ui-chips" role="radiogroup" aria-label="Вид">
            {#each KINDS as [k, one] (k)}
              <button class="ui-chip" class:on={draft.kind === k} role="radio" aria-checked={draft.kind === k} onclick={() => (draft.kind = k)}>{one}</button>
            {/each}
          </div>
          <label class="art-field"><span>Название</span><input class="text-input" bind:value={draft.nameRu} maxlength="200" /></label>
          <label class="art-field"><span>Название по-английски</span><input class="text-input" bind:value={draft.nameEn} maxlength="200" lang="en" /></label>
          <label class="art-field"><span>Кратко — одно-два предложения (карточка «Что это?»)</span><textarea class="text-area" rows="3" bind:value={draft.briefRu} maxlength="600"></textarea></label>
          <label class="art-field"><span>Кратко по-английски</span><textarea class="text-area" rows="2" bind:value={draft.briefEn} maxlength="600" lang="en"></textarea></label>
          <label class="art-field"><span>Подробно — ссылки на абзацы «5:1.3», **жирный**, *курсив*</span><textarea class="text-area" rows="10" bind:value={draft.bodyRu} maxlength="20000"></textarea></label>
          <label class="art-field"><span>Подробно по-английски</span><textarea class="text-area" rows="4" bind:value={draft.bodyEn} maxlength="20000" lang="en"></textarea></label>
          <div class="art-row">
            <button class="ui-btn primary" onclick={save} disabled={saving || !draft.nameRu.trim()}>Сохранить</button>
            {#if a.status === 'draft'}<button class="ui-btn" onclick={() => setStatus('published')} disabled={saving}>Опубликовать</button>
            {:else}<button class="ui-btn" onclick={() => setStatus('draft')} disabled={saving}>Снять в черновики</button>{/if}
            <button class="link-btn" onclick={() => (editing = false)}>Готово</button>
          </div>

          <div class="ui-label">Имена в тексте — по ним найдены места</div>
          <div class="ui-chips">
            {#each a.names as n (n.id)}
              <span class="ui-chip art-name-chip">{n.ru} · <span lang="en">{n.en}</span>
                <button class="art-x" aria-label="Убрать имя {n.ru}" onclick={() => a && setNames(a.names.filter((x) => x.id !== n.id).map((x) => x.id))}><Icon name="close" size={14} /></button></span>
            {:else}<span class="muted small">Нет имён из глоссария — места в тексте не найти.</span>{/each}
          </div>
          <input class="text-input" bind:value={nameQuery} placeholder="Добавить имя из глоссария" aria-label="Имя из глоссария" />
          {#each nameOptions as g (g.id)}
            <button class="art-option" onclick={() => a && (setNames([...a.names.map((x) => x.id), g.id]), (nameQuery = ''))}>{g.ru} · <span lang="en">{g.en}</span></button>
          {/each}

          <div class="ui-label">Главные места</div>
          {#each a.places as p, i (p.ref)}
            <div class="art-place-edit">
              <a href="/{p.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${p.ref}`))}>{p.ref}</a>
              <input class="text-input" value={p.note} placeholder="Чем важно это место" aria-label="Пояснение к {p.ref}"
                onchange={(e) => setPlaces(places.map((x, j) => (j === i ? { ...x, note: e.currentTarget.value } : x)))} />
              <button class="ui-round small plain" disabled={i === 0} aria-label="Выше" onclick={() => movePlace(i, -1)}><Icon name="up" size={16} /></button>
              <button class="ui-round small plain" disabled={i === a.places.length - 1} aria-label="Ниже" onclick={() => movePlace(i, 1)}><Icon name="down" size={16} /></button>
              <button class="ui-round small plain" aria-label="Убрать {p.ref}" onclick={() => setPlaces(places.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div>
          {/each}
          {#if hints?.some((h) => !a?.places.some((p) => p.ref === h.ref))}
            <p class="ui-hint">Подсказки: первое упоминание и места, где говорится, что это такое.</p>
            {#each hints.filter((h) => !a?.places.some((p) => p.ref === h.ref)) as h (h.ref)}
              <div class="art-hint">
                <span class="art-hint-text"><b>{h.ref}</b>{h.first ? ' · первое упоминание' : ''} — {h.ru.slice(0, 160)}{h.ru.length > 160 ? '…' : ''}</span>
                <button class="ui-round small" aria-label="В главные места {h.ref}" onclick={() => setPlaces([...places, { ref: h.ref, note: h.first ? 'Первое упоминание' : '' }])}><Icon name="plus" size={16} /></button>
              </div>
            {/each}
          {/if}
          <form class="art-row" onsubmit={(e) => (e.preventDefault(), refToAdd.trim() && (setPlaces([...places, { ref: refToAdd.trim(), note: '' }]), (refToAdd = '')))}>
            <input class="text-input" bind:value={refToAdd} placeholder="Абзац, например 5:1.3" aria-label="Добавить абзац" />
            <button class="ui-btn small">Добавить</button>
          </form>

          <div class="ui-label">Связанные статьи</div>
          {#each a.links as l (l.id)}
            <div class="art-link-edit">
              <span>{l.nameRu}</span>
              <select class="text-input" value={l.kind} aria-label="Связь с {l.nameRu}"
                onchange={(e) => a && setLinks(a.links.map((x) => ({ id: x.id, kind: x.id === l.id ? e.currentTarget.value : x.kind })))}>
                <option value="related">связано</option><option value="part">часть</option><option value="belongs">принадлежит</option>
              </select>
              <button class="ui-round small plain" aria-label="Убрать связь" onclick={() => a && setLinks(a.links.filter((x) => x.id !== l.id).map((x) => ({ id: x.id, kind: x.kind })))}><Icon name="close" size={16} /></button>
            </div>
          {/each}
          <input class="text-input" bind:value={linkQuery} placeholder="Связать со статьёй" aria-label="Связать со статьёй" />
          {#each linkOptions as o (o.id)}
            <button class="art-option" onclick={() => a && (setLinks([...a.links.map((x) => ({ id: x.id, kind: x.kind })), { id: o.id, kind: 'related' }]), (linkQuery = ''))}>{o.nameRu}{o.status === 'draft' ? ' · черновик' : ''}</button>
          {/each}

          <button class="link-btn art-delete" class:danger={confirmDelete} onclick={remove}>{confirmDelete ? 'Нажмите ещё раз — статья удалится' : 'Удалить статью'}</button>
        </section>
      {:else}
        <!-- ---- reading ---- -->
        {#if brief}<p class="art-brief">{brief}</p>{:else if !body}<p class="muted">Описание ещё пишется.</p>{/if}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        {#if body}<div class="art-body" onclick={onTextClick}>{@html renderBody(body)}</div>{/if}

        {#if a.places.length}
          <div class="ui-label">Главные места</div>
          <ul class="ui-cards">
            {#each a.places as p (p.ref)}
              <li>
                <a class="ui-card art-place" href="/{p.ref}" onclick={(e) => (e.preventDefault(), navigate(`/${p.ref}`))}>
                  <span class="art-place-head"><b>{p.ref}</b><span class="muted ellipsis">{p.paperTitle}</span></span>
                  {#if p.note}<span class="art-place-note">{p.note}</span>{/if}
                  <span class="art-place-text" lang={en ? 'en' : 'ru'}>{en ? p.en : p.ru}</span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}

        {#if a.links.length}
          <div class="ui-label">Связанные</div>
          <div class="ui-chips">
            {#each a.links as l (l.id)}
              <a class="ui-chip" href="/d/{l.id}" onclick={(e) => (e.preventDefault(), navigate(`/d/${l.id}`))}>
                <span class="muted">{LINK_NAMES[l.kind]}:</span>&nbsp;{en && l.nameEn ? l.nameEn : l.nameRu}</a>
            {/each}
          </div>
        {/if}

        <!-- its discussion: a chat of its own, as a paragraph's -->
        <div class="ui-label">Обсуждение</div>
        <button class="ui-card art-discuss" onclick={discuss}>
          <span class="ui-tile"><Icon name="discuss" size={18} /></span>
          <span class="art-discuss-text">
            <b>{messages ? `${messages} ${plural(messages, 'сообщение', 'сообщения', 'сообщений')}` : 'Обсудить статью'}</b>
            <span class="muted small">{messages ? 'Вопросы, мысли и уточнения читателей' : 'Вопрос, мысль, уточнение — видят все участники'}</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      {/if}

      <div class="ui-label">В тексте книги</div>
      {#if a.occurrences.paragraphs}
        <p class="art-count">
          {a.occurrences.paragraphs} {plural(a.occurrences.paragraphs, 'абзац', 'абзаца', 'абзацев')} в {a.occurrences.papers} {plural(a.occurrences.papers, 'Тексте', 'Текстах', 'Текстах')}{#if a.occurrences.first}
            {' · '}впервые — <a href="/{a.occurrences.first}" onclick={(e) => (e.preventDefault(), navigate(`/${a?.occurrences.first}`))}>{a.occurrences.first}</a>{/if}
        </p>
        <ul class="art-papers">
          {#each allPapers ? a.occurrences.byPaper : a.occurrences.byPaper.slice(0, 6) as p (p.paper)}
            <li>
              <span class="art-paper"><b>{paperLabel(p.paper)}</b> <span class="muted">{en ? p.titleEn : p.titleRu}</span></span>
              <span class="art-refs">
                {#each p.refs as ref (ref)}<a href="/{ref}" onclick={(e) => (e.preventDefault(), navigate(`/${ref}`))}>{ref.split(':')[1]}</a>{/each}
              </span>
            </li>
          {/each}
        </ul>
        {#if a.occurrences.byPaper.length > 6 && !allPapers}
          <button class="link-btn" onclick={() => (allPapers = true)}>Все Тексты ({a.occurrences.byPaper.length})</button>
        {/if}
      {:else}
        <p class="muted">{a.names.length ? 'Имена статьи в тексте не найдены.' : 'У статьи нет имён из глоссария — места в тексте не известны.'}</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .dict-page {
    height: 100%;
    overflow: auto;
    background: var(--bg);
  }
  .dict-inner {
    display: grid;
    gap: var(--space-3);
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-16);
  }
  .dict-back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .art-head {
    display: grid;
    gap: 2px;
  }
  .art-kind {
    color: var(--muted);
    font: 500 12px/16px var(--sans);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .art-draft {
    color: var(--accent);
  }
  .art-name {
    margin: 0;
    font: 600 28px/34px var(--sans);
  }
  .art-en {
    font: 16px/22px var(--sans);
  }
  .art-tools {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .art-tools .ui-btn {
    width: auto;
  }
  .art-brief {
    margin: 0;
    font: 18px/1.55 var(--text-font, var(--serif));
  }
  .art-body {
    font: 16px/1.65 var(--text-font, var(--serif));
  }
  .art-place {
    display: grid;
    gap: 6px;
  }
  .art-discuss {
    width: 100%;
    align-items: center;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .art-discuss-text {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 2px;
  }
  .art-place-head {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
  }
  .art-place-note {
    font: 500 14px/20px var(--sans);
  }
  .art-place-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    color: var(--muted);
    font: 15px/1.5 var(--text-font, var(--serif));
  }
  .art-count {
    margin: 0;
  }
  .art-papers {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .art-papers li {
    display: grid;
    gap: 4px;
  }
  .art-refs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font: 14px/20px var(--sans);
  }
  .art-edit {
    display: grid;
    gap: var(--space-3);
  }
  .art-field {
    display: grid;
    gap: 4px;
  }
  .art-field span {
    color: var(--muted);
    font: 13px/18px var(--sans);
  }
  .art-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .art-row .ui-btn {
    width: auto;
  }
  .art-name-chip {
    gap: 6px;
  }
  .art-x {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .art-option {
    justify-self: start;
    padding: 6px 12px;
    border: 1px solid var(--ui-line);
    border-radius: 16px;
    background: var(--ui-card);
    color: var(--text);
    cursor: pointer;
  }
  .art-place-edit,
  .art-link-edit,
  .art-hint {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .art-place-edit input,
  .art-link-edit span {
    flex: 1;
    min-width: 0;
  }
  .art-link-edit select {
    width: auto;
  }
  .art-hint-text {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    font: 14px/20px var(--sans);
  }
  .art-delete {
    justify-self: start;
    margin-top: var(--space-4);
  }
  @media (max-width: 767px) {
    .dict-inner {
      padding: var(--space-4) calc(var(--space-4) + var(--safe-right)) calc(var(--m-nav) + var(--safe-bottom) + var(--space-8)) calc(var(--space-4) + var(--safe-left));
    }
    .dict-back {
      display: none; /* (the phone's header has its ←) */
    }
  }
</style>
