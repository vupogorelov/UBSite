// Applies the cached theme before first paint to avoid a light flash in dark mode.
// A separate file (not inline) so that the Content-Security-Policy can forbid inline scripts.
// Two themes: Paper (light) and Graphite (dark); older names map onto them.
try {
  const s = JSON.parse(localStorage.getItem('ub.settings') || '{}');
  const dark = s.theme === 'graphite' || s.theme === 'dark' ||
    ((!s.theme || s.theme === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'graphite' : 'paper';
} catch {}
