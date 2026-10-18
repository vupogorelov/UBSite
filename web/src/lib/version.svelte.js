// @ts-check
// Updates, both kinds, in one place (the bell's «Обновление» card: NotificationsMenu):
// - the site: the build writes its id to /version.json; the running app compares it with its own —
//   a newer one is taken by restarting (`restart`), on the fly;
// - the Android app (android/): the site serves its APK and /app/version.json with its version; the app
//   tells its own (native.appVersion) — a newer one is installed (`install`), the system asks.
// Both are checked with the bell's polling (a minute, and on coming back to the app).
import { native } from './native.js';
import { showToast } from './toast.svelte.js';

/* global __BUILD_ID__ */

/** `updated`: a newer build of the site; `app`: the Android app's installed and newest versions (newer — an update). */
export const version = $state({ updated: false, app: { installed: '', latest: '' } });

/** The app can save a file (its APK) itself: 1.3 and later (version 2 of its bridge); older — through the browser. */
export const canInstall = (native?.version() ?? 0) >= 2;
version.app.installed = canInstall ? (native?.appVersion?.() ?? '') : '';

/** Whether a newer Android app is out (in the app only). */
export const appUpdate = () => !!native && !!version.app.latest && version.app.latest !== version.app.installed;

/** Asks the server which build of the site, and which version of the app, it serves now. */
export async function checkVersion() {
  if (!import.meta.env.PROD) return;
  try {
    if (!version.updated) {
      const res = await fetch('/version.json', { cache: 'no-store' });
      const { build } = res.ok ? await res.json() : {};
      if (build && build !== __BUILD_ID__) version.updated = true;
    }
    if (native) {
      const res = await fetch('/app/version.json', { cache: 'no-store' });
      const { name } = res.ok ? await res.json() : {};
      if (typeof name === 'string') version.app.latest = name;
    }
  } catch {} // offline: next time
}

/** Restarts the app on the new build of the site (the page is reloaded from the network). */
export function restart() {
  location.reload();
}

/** Installs the newest Android app: its APK is downloaded, the system offers to install it over this one. */
export function install() {
  if (canInstall) location.href = '/app/upexplorer.apk';
  else showToast('Один раз — через Chrome: Ещё → Android приложение');
}
