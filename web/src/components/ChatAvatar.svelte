<script>
  import { visibility } from '../lib/visibility.js';
  import Icon from './Icon.svelte';

  /**
   * A chat's round avatar (§ paragraph, # channel, a letter for a workspace) with a small badge at
   * its bottom right: who can read the chat — globe (everyone), two people (members), lock (private).
   * @type {{ chat: { kind: string, title: string, members?: number } | null }}
   */
  let { chat } = $props();

  const text = $derived(!chat ? '' : chat.kind === 'chan' ? '#' : chat.kind === 'para' ? '§' : chat.title.slice(0, 1).toUpperCase());
  const vis = $derived(chat ? visibility(chat) : null);
</script>

<span class="tg-chat-avatar" data-kind={chat?.kind}>
  {text}
  {#if vis}<span class="tg-vis-badge" title={vis.full} role="img" aria-label={vis.full}><Icon name={vis.icon} size={11} /></span>{/if}
</span>
