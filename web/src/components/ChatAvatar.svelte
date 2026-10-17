<script>
  import { visibility } from '../lib/visibility.js';
  import Icon from './Icon.svelte';

  /**
   * A chat's round avatar (§ paragraph, # channel, a letter for a workspace) with small badges:
   * bottom right shows who can read it (a broadcast channel is marked by its title, not here). The Book's voice channel
   * keeps the open book as its main mark.
   * @type {{ chat: { kind: string, title: string, members?: number, voice?: boolean } | null }}
   */
  let { chat } = $props();

  const text = $derived(!chat ? '' : chat.kind === 'chan' ? '#' : chat.kind === 'para' ? '§' : chat.title.slice(0, 1).toUpperCase());
  const vis = $derived(chat ? visibility(chat) : null);
</script>

<span class="tg-chat-avatar" data-kind={chat?.voice || chat?.kind === 'dm' ? 'voice' : chat?.kind}>
  {#if chat?.voice || chat?.kind === 'dm'}<Icon name="book-open" size={20} />{:else if chat?.kind === 'dict'}<Icon name="dictionary" size={20} />{:else}{text}{/if}
  {#if vis}<span class="tg-vis-badge" title={vis.full} role="img" aria-label={vis.full}><Icon name={vis.icon} size={11} /></span>{/if}
</span>
