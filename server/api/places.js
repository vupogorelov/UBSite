// @ts-check
// Where the reader stopped, reading and listening — one place of each kind per user, shared by all
// their devices and workspaces. The latest (by the device's clock) wins.
import { HttpError, readJson } from '../http.js';

const KINDS = ['read', 'listen'];

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function registerPlaceRoutes(router, db) {
  const q = {
    all: db.prepare(
      `SELECT kind, paper, key, s, lang, progress, device, device_kind AS deviceKind, at, file, t FROM reading_places WHERE user_id = ?`,
    ),
    put: db.prepare(
      `INSERT INTO reading_places (user_id, kind, paper, key, s, lang, progress, device, device_kind, at, file, t)
       VALUES (:user, :kind, :paper, :key, :s, :lang, :progress, :device, :deviceKind, :at, :file, :t)
       ON CONFLICT (user_id, kind) DO UPDATE SET paper = excluded.paper, key = excluded.key, s = excluded.s,
         lang = excluded.lang, progress = excluded.progress, device = excluded.device,
         device_kind = excluded.device_kind, at = excluded.at, file = excluded.file, t = excluded.t
       WHERE excluded.at >= reading_places.at`,
    ),
  };

  /** @param {number} userId */
  const places = (userId) =>
    Object.fromEntries(KINDS.map((k) => [k, /** @type {any[]} */ (q.all.all(userId)).find((p) => p.kind === k) ?? null]));

  router.on('GET', '/api/places', ({ user }) => places(user.id));

  // { paper, key, s?, lang, progress?, device, deviceKind, at, file?, t? } — an older one than stored is ignored.
  // file, t: listening to a recording — its file and the second in it.
  router.on('PUT', '/api/places/:kind', async ({ req, params, user }) => {
    const kind = params.kind;
    if (!KINDS.includes(kind)) throw new HttpError(404, 'Неизвестный вид места');
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const paper = Number(b.paper);
    const key = typeof b.key === 'string' ? b.key : '';
    if (!Number.isInteger(paper) || paper < 0 || !/^(\d+:\d+\.\d+|h\d+)$/.test(key)) throw new HttpError(400, 'Неверное место в книге');
    const lang = typeof b.lang === 'string' && /^[a-z]{2,3}$/.test(b.lang) ? b.lang : null;
    const device = typeof b.device === 'string' && /^[\w-]{6,64}$/.test(b.device) ? b.device : null;
    if (!lang || !device) throw new HttpError(400, 'Нужны язык и устройство');
    const progress = typeof b.progress === 'number' && b.progress >= 0 && b.progress <= 1 ? b.progress : null;
    // the device's clock, but never ahead of the server's (a wrong clock must not freeze the place)
    const at = Math.min(Number.isFinite(Number(b.at)) ? Math.round(Number(b.at)) : Date.now(), Date.now());
    q.put.run({
      user: user.id, kind, paper, key, s: Number.isInteger(b.s) ? Number(b.s) : 0, lang, progress, device,
      deviceKind: b.deviceKind === 'phone' ? 'phone' : 'computer', at,
      file: typeof b.file === 'string' && /^[\w.-]{1,80}$/.test(b.file) ? b.file : null,
      t: typeof b.t === 'number' && Number.isFinite(b.t) && b.t >= 0 && b.t < 36_000 ? Math.round(b.t * 10) / 10 : null,
    });
    return places(user.id)[kind];
  });
}
