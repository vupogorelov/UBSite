// @ts-check
// A newer build of the app is out: the build writes its id to /version.json; the running app
// compares it with its own (with the bell's polling) and the bell offers a restart.

/* global __BUILD_ID__ */

export const version = $state({ updated: false });

/** Asks the server which build it serves now. */
export async function checkVersion() {
  if (version.updated || !import.meta.env.PROD) return;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    if (build && build !== __BUILD_ID__) version.updated = true;
  } catch {} // offline: next time
}

/** Restarts the app on the new build (the page is reloaded from the network). */
export function restart() {
  location.reload();
}
