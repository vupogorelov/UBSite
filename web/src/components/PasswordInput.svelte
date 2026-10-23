<script>
  import Icon from './Icon.svelte';

  /**
   * A password's field with an eye at its end: shows what is typed, and hides it again (the field keeps its
   * focus and its caret). `cls`: the field's own look (text-input, ui-input).
   * @type {{ id: string, value: string, cls?: string, autocomplete?: 'current-password' | 'new-password', minlength?: number, required?: boolean }}
   */
  let { id, value = $bindable(''), cls = 'text-input', autocomplete = 'current-password', minlength, required = true } = $props();

  let shown = $state(false);
</script>

<span class="pw-field">
  <input {id} class={cls} type={shown ? 'text' : 'password'} bind:value {autocomplete} {minlength} {required}
    autocapitalize="off" autocorrect="off" spellcheck="false" />
  <!-- (pointerdown kept from the field: the keyboard stays, the caret where it was) -->
  <button type="button" class="pw-eye" aria-pressed={shown} aria-controls={id}
    aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'} title={shown ? 'Скрыть пароль' : 'Показать пароль'}
    onpointerdown={(e) => e.preventDefault()} onclick={() => (shown = !shown)}>
    <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
  </button>
</span>
