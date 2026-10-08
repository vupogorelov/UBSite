// Applies the cached theme before first paint to avoid a light flash in dark mode.
// A separate file (not inline) so that the Content-Security-Policy can forbid inline scripts.
try {
  const s = JSON.parse(localStorage.getItem('ub.settings') || '{}');
  if (s.theme === 'sepia') s.theme = 'paper'; // Sepia was replaced by Paper
  const theme =
    s.theme && s.theme !== 'system' ? s.theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
} catch {}
