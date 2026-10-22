// @ts-check
// «Что нового»: the entries of whatsnew.md (server/features/whatsnew.js), by date, the newest first; the
// newest one not seen yet is offered by the bell. What was seen is a setting of one's own (the same on
// every device).
import { request, shown } from '../../lib/api.js';
import { settings, setSetting } from '../../lib/settings.svelte.js';
import { parse, dateText } from './entries.js';

export { dateText };

export const whatsNew = $state(/** @type {{ entries: import('./entries.js').Entry[], loaded: boolean }} */ ({ entries: [], loaded: false }));

/** Whether the newest entry is not seen yet. */
export const unseen = () => !!whatsNew.entries[0] && whatsNew.entries[0].date > (settings.whatsNewSeen ?? '');

let asked = false;
/** Loaded once a run (the file changes with a new build: the app is restarted for it). */
export async function loadWhatsNew() {
  if (asked) return;
  asked = true;
  try {
    // (what the device saw last, at once; the network's answer over it)
    await shown(request('GET', '/api/whatsnew'), (/** @type {{ markdown: string }} */ r) => {
      whatsNew.entries = parse(r.markdown);
      whatsNew.loaded = true;
    });
  } catch {
    asked = false; // (offline: next time)
  } finally {
    whatsNew.loaded = true;
  }
}

/** All the entries seen (the page opened). */
export function markSeen() {
  const latest = whatsNew.entries[0]?.date;
  if (latest && latest > (settings.whatsNewSeen ?? '')) setSetting('whatsNewSeen', latest);
}
