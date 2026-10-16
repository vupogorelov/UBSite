// @ts-check
// Workspace settings: the server is the source of truth; localStorage only caches them
// so the first paint already has the right theme and font.
import { settingDefaults, sanitizeSettings } from '../../../shared/settings.js';
import { api } from './api.js';
import { native } from './native.js';
import { resolveHighlightColors } from './highlight.js';

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

/** Whether the dark theme (Graphite) is on — chosen, or as on the device until the first switch. */
export const theme = {
  get dark() {
    return settings.theme === 'graphite' || (settings.theme !== 'paper' && system.dark);
  },
};

/**
 * The phone's status bar (and the installed app's title bar) takes the color the header really has
 * on this screen (the book's header, or a section screen's, which is the page's color). Call after
 * the theme or the screen changed.
 */
export function syncStatusBar() {
  const bar = document.querySelector('.topbar');
  const color = (bar && getComputedStyle(bar).backgroundColor) || getComputedStyle(document.documentElement).getPropertyValue('--sidebar').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color);
    meta.removeAttribute('media');
  }
  // the Android app colors its bars itself: the header's color on top, the page's below (the
  // navigation floats above the page)
  if (!native) return;
  const page = getComputedStyle(document.body).backgroundColor;
  native.bars(color, /^transparent$|,\s*0\)$/.test(page) ? color : page);
}

/** Mirrors settings onto <html> attributes and CSS variables; call inside an $effect. */
export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = theme.dark ? 'graphite' : 'paper';
  root.dataset.font = settings.fontFamily;
  root.dataset.align = settings.textAlign;
  root.dataset.hyphens = settings.hyphens ? 'on' : 'off';
  root.dataset.glass = settings.glassBars ? 'on' : 'off';
  root.dataset.navLabels = settings.navLabels ? 'on' : 'off';
  root.dataset.navStyle = settings.navStyle;
  root.dataset.flash = settings.flashTone;
  root.dataset.chatBg = settings.chatBg;
  root.dataset.chatWallpaper = settings.chatWallpaper;
  root.dataset.chatBubble = settings.chatBubble;
  root.dataset.chatOwn = settings.chatOwn;
  root.dataset.chatFont = settings.chatFont;
  root.style.setProperty('--chat-radius', `${settings.chatRadius}px`);
  queueMicrotask(syncStatusBar);
  queueMicrotask(resolveHighlightColors); // (old Chrome: the theme's colors into ::highlight())
  root.style.setProperty('--font-size', `${settings.fontSize}px`);
  root.style.setProperty('--chat-font-size', `${settings.chatFontSize}px`);
  root.style.setProperty('--kanban-font-size', `${settings.kanbanFontSize}px`);
  root.style.setProperty('--task-list-font-size', `${settings.taskListFontSize}px`);
  root.style.setProperty('--line-height', String(settings.lineHeight));
  // Geist and Roboto are variable; the serif face has just regular and bold.
  root.style.setProperty('--font-weight', String(settings.fontFamily === 'serif' ? 400 : settings.fontWeight));
  root.style.setProperty('--column-width', `${settings.columnWidth}px`);
}
