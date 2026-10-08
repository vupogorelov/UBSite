<script>
  import { tags, loadTags, tagKey, cleanTagName, tagColor } from '../lib/tags.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { blurOnRemove } from '../lib/focus.js';

  /**
   * Chips for the current tags plus an input with autocompletion from the workspace tags.
   * @type {{ value: string[], onchange: (names: string[]) => void, autofocus?: boolean }}
   */
  let { value, onchange, autofocus = false } = $props();

  let text = $state('');
  let highlighted = $state(0);
  let navigated = $state(false);
  /** @type {HTMLInputElement} */
  let input;

  $effect(() => {
    loadTags();
    if (autofocus) input.focus({ preventScroll: true });
  });

  const suggestions = $derived.by(() => {
    const t = tagKey(text.trim().replace(/^#/, ''));
    const taken = new Set(value.map(tagKey));
    const list = tags.list.filter((x) => !taken.has(tagKey(x.name)));
    if (!t) return list.toSorted((a, b) => b.count - a.count).slice(0, 8);
    const starts = list.filter((x) => tagKey(x.name).startsWith(t) || tagKey(x.name).includes('/' + t));
    const contains = list.filter((x) => !starts.includes(x) && tagKey(x.name).includes(t));
    return [...starts, ...contains].slice(0, 8);
  });

  /** @param {string} raw */
  function add(raw) {
    const name = cleanTagName(raw);
    if (!name) {
      if (raw.trim()) showToast('Тег: буквы, цифры, _ и -, уровни через /');
      return;
    }
    // Reuse the existing spelling of a tag that differs only in case.
    const existing = tags.list.find((x) => tagKey(x.name) === tagKey(name));
    const final = existing?.name ?? name;
    if (!value.some((v) => tagKey(v) === tagKey(final))) onchange([...value, final]);
    text = '';
    highlighted = 0;
  }

  /** @param {string} name */
  function remove(name) {
    onchange(value.filter((v) => v !== name));
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ',' || (e.key === ' ' && text.trim())) {
      e.preventDefault();
      // A suggestion is taken only after choosing it with the arrows; otherwise the typed text.
      add(navigated && suggestions[highlighted] ? suggestions[highlighted].name : text);
      navigated = false;
    } else if (e.key === 'Tab' && text.trim() && suggestions.length) {
      e.preventDefault();
      add(suggestions[highlighted]?.name ?? text);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = navigated ? Math.min(highlighted + 1, suggestions.length - 1) : 0;
      navigated = true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
      navigated = true;
    } else if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      text = '';
    }
  }
</script>

<div class="tag-input">
  <div class="tag-chips">
    {#each value as name (name)}
      <span class="tag-chip" data-color={tagColor(name)}>
        #{name}
        <button type="button" aria-label={`Убрать тег ${name}`} onclick={() => remove(name)}>×</button>
      </span>
    {/each}
    <input
      use:blurOnRemove
      bind:this={input}
      bind:value={text}
      oninput={() => ((highlighted = 0), (navigated = false))}
      onkeydown={onKey}
      placeholder={value.length ? '' : '#тег или тема/подтема'}
      aria-label="Добавить тег"
      spellcheck="false"
    />
  </div>
  {#if suggestions.length}
    <ul class="tag-suggest" role="listbox">
      {#each suggestions as s, i (s.name)}
        <li role="option" aria-selected={i === highlighted}>
          <button type="button" class:on={navigated && i === highlighted} onmousedown={(e) => e.preventDefault()} onclick={() => add(s.name)}>
            #{s.name}<span class="muted">{s.count}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
