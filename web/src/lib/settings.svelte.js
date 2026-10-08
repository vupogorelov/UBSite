// @ts-check
// Workspace settings: the server is the source of truth; localStorage only caches them
// so the first paint already has the right theme and font.
import { settingDefaults, sanitizeSettings } from '../../../shared/settings.js';
import { api } from './api.js';

/** @typedef {import('../../../shared/settings.js').Settings} Settings */

const CACHE_KEY = 'ub.settings';

function readCache() {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}
function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {}
}

/** @type {Settings} */
export const settings = $state({ ...settingDefaults(), ...readCache() });
export const workspace = $state({ name: '' });

export async function loadSettings() {
  const ws = await api.workspace();
  workspace.name = ws.name;
  Object.assign(settings, ws.settings);
  writeCache();
}

/** @type {Partial<Settings>} */
let pending = {};
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

/**
 * @template {keyof Settings} K
 * @param {K} key
 * @param {Settings[K]} value
 */
export function setSetting(key, value) {
  settings[key] = value;
  pending[key] = value;
  writeCache();
  clearTimeout(timer);
  timer = setTimeout(() => {
    const patch = pending;
    pending = {};
    api.saveSettings(patch).catch((err) => console.error('Settings not saved:', err));
  }, 400);
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const system = $state({ dark: darkQuery.matches });
darkQuery.addEventListener('change', (e) => (system.dark = e.matches));

/** Mirrors settings onto <html> attributes and CSS variables; call inside an $effect. */
export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme === 'system' ? (system.dark ? 'dark' : 'light') : settings.theme;
  root.dataset.font = settings.fontFamily;
  // The phone's status bar (and the installed app's title bar) takes the color of the top bar.
  queueMicrotask(() => {
    const color = getComputedStyle(root).getPropertyValue('--sidebar').trim();
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', color);
      meta.removeAttribute('media');
    }
  });
  root.style.setProperty('--font-size', `${settings.fontSize}px`);
  root.style.setProperty('--line-height', String(settings.lineHeight));
  // Geist and Roboto are variable; the serif face has just regular and bold.
  root.style.setProperty('--font-weight', String(settings.fontFamily === 'serif' ? 400 : settings.fontWeight));
  root.style.setProperty('--column-width', `${settings.columnWidth}px`);
}
