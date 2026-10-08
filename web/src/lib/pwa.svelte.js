// @ts-check
// Installing the app (PWA): the service worker, the browser's install prompt, the iOS hint.

/* global __BUILD_ID__ */

export const pwa = $state({
  /** The browser offered installation (Chrome, Edge, Android). */ canInstall: false,
  /** iOS Safari: installation goes through Share → "На экран «Домой»". */ ios: false,
  /** Already running as an installed app. */ installed: false,
});

/** @type {any} */
let deferred = null;

export function initPwa() {
  pwa.installed = matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  pwa.ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !pwa.installed;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    pwa.canInstall = true;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    pwa.canInstall = false;
    pwa.installed = true;
  });
  // The worker comes with production builds only (the dev server reloads by itself).
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {});
  }
}

/** Shows the browser's install dialog. */
export async function install() {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  pwa.canInstall = false;
}
