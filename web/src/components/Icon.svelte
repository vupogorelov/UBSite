<script>
  // Line icons in the style of the UI reference (Lucide-like, 24px grid, 1.8 stroke).
  /** @type {{ name: import('../lib/icon-names.js').IconName, size?: number }} */
  let { name, size = 20 } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width={size < 16 ? 2 : 1.8}
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'menu'}
    <path d="M4 6h16M4 12h16M4 18h16" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  {:else if name === 'alert'}
    <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
  {:else if name === 'image'}
    <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  {:else if name === 'share'}
    <path d="M12 3v12M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  {:else if name === 'download'}
    <path d="M12 3v12M8 11l4 4 4-4" /><path d="M5 21h14" />
  {:else if name === 'cloud-download'}
    <path d="M12 13v8M8 17l4 4 4-4M4.39 15.27A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.44 8.28" />
  {:else if name === 'settings'}
    <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
    <circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" />
  {:else if name === 'theme'}
    <circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
  {:else if name === 'pin'}
    <path d='M12 17v5M9 3h6M10 3v7l-3 4v3h10v-3l-3-4V3' />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === 'chevron'}
    <path d="m9 6 6 6-6 6" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />
  {:else if name === 'star'}
    <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />
  {:else if name === 'history'}
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /><path d="M12 8v4l3 2" />
  {:else if name === 'help'}
    <circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.2" />
  {:else if name === 'trash'}
    <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
  {:else if name === 'edit'}
    <path d="M5 19h4L19 9l-4-4L5 15z" />
  {:else if name === 'up'}
    <path d="m6 15 6-6 6 6" />
  {:else if name === 'down'}
    <path d="m6 9 6 6 6-6" />
  {:else if name === 'toc'}
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.2" />
  {:else if name === 'notes'}
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z" /><path d="M15 3v4a2 2 0 0 0 2 2h4" />
  {:else if name === 'tag'}
    <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
  {:else if name === 'translate'}
    <path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
  {:else if name === 'bookmark'}
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  {:else if name === 'comment'}
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  {:else if name === 'discuss'}
    <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
  {:else if name === 'bell'}
    <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8a6 6 0 0 0-12 0c0 4.5-1.4 6-2.7 7.3" />
  {:else if name === 'megaphone'}
    <path d="m3 11 12-5v12L3 13z" />
    <path d="M15 9.5h2a3 3 0 0 1 0 6h-2" />
    <path d="m7 14 1.5 5h3L10 15" />
  {:else if name === 'copy'}
    <rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
  {:else if name === 'eye'}
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
  {:else if name === 'eye-off'}
    <path d="M10.7 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20" />
  {:else if name === 'layers'}
    <path d="m12 2.7 9.2 4.6L12 12 2.8 7.3z" /><path d="m2.8 12 9.2 4.7 9.2-4.7" /><path d="m2.8 16.7 9.2 4.6 9.2-4.6" />
  {:else if name === 'grip'}
    <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'dictionary'}
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" /><path d="m8.5 13 3.5-7 3.5 7" /><path d="M9.6 11h4.8" />
  {:else if name === 'book-open'}
    <path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  {:else if name === 'link'}
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  {:else if name === 'back'}
    <path d="m12 19-7-7 7-7M19 12H5" />
  {:else if name === 'check-square'}
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" />
  {:else if name === 'calendar'}
    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  {:else if name === 'list'}
    <path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13" stroke-width="2.2" />
  {:else if name === 'kanban'}
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" />
  {:else if name === 'inbox'}
    <path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
  {:else if name === 'check'}
    <path d="M20 6 9 17l-5-5" />
  {:else if name === 'more'}
    <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
  {:else if name === 'dots'}
    <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
  {:else if name === 'headphones'}
    <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
  {:else if name === 'play'}
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" />
  {:else if name === 'pause'}
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
  {:else if name === 'stop'}
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
  {:else if name === 'play-line'}
    <path d="M7 4.5v15L19.5 12z" stroke-linejoin="miter" />
  {:else if name === 'stop-line'}
    <path d="M6.5 6.5h11v11h-11z" stroke-linejoin="miter" />
  {:else if name === 'skip-back'}
    <path d="M18 19 9 12l9-7z" fill="currentColor" /><path d="M6 5v14" />
  {:else if name === 'skip-forward'}
    <path d="m6 5 9 7-9 7z" fill="currentColor" /><path d="M18 5v14" />
  {:else if name === 'rewind'}
    <path d="M11 19 3 12l8-7zM21 19l-8-7 8-7z" fill="currentColor" />
  {:else if name === 'fast-forward'}
    <path d="m13 5 8 7-8 7zM3 5l8 7-8 7z" fill="currentColor" />
  {:else if name === 'reset'}
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
  {:else if name === 'globe'}
    <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
  {:else if name === 'users'}
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  {:else if name === 'lock'}
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
  {:else if name === 'ruble'}
    <path d="M7 11h7a4 4 0 0 0 0-8H9v18M6 15h8" />
  {:else if name === 'minus'}
    <path d="M5 12h14" />
  {/if}
</svg>
