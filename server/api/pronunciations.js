// @ts-check
// The pronunciation dictionary for reading aloud: everyone reads it, coordinators edit.
import { HttpError, readJson } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function registerPronunciationRoutes(router, db) {
  const q = {
    list: db.prepare('SELECT id, lang, written, spoken FROM pronunciations ORDER BY lang, lower(written)'),
    insert: db.prepare('INSERT INTO pronunciations (lang, written, spoken, created_by) VALUES (?, ?, ?, ?) RETURNING id'),
    update: db.prepare("UPDATE pronunciations SET lang = ?, written = ?, spoken = ?, updated_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM pronunciations WHERE id = ?'),
  };
  /** @param {import('../auth.js').User} user */
  const requireCoordinator = (user) => {
    if (!user.isCoordinator && !user.isAdmin) throw new HttpError(403, 'Словарь произношения ведут координаторы');
  };
  /** @param {import('node:http').IncomingMessage} req */
  async function entry(req) {
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const lang = b.lang === 'en' ? 'en' : 'ru';
    const written = typeof b.written === 'string' ? b.written.trim() : '';
    const spoken = typeof b.spoken === 'string' ? b.spoken.trim() : '';
    if (!written || !spoken) throw new HttpError(400, 'Нужны оба поля: как написано и как читать');
    if (written.length > 80 || spoken.length > 160) throw new HttpError(400, 'Слишком длинно');
    return { lang, written, spoken };
  }
  /** @param {() => unknown} fn */
  const unique = (fn) => {
    try {
      return fn();
    } catch (err) {
      if (/UNIQUE/.test(String(err))) throw new HttpError(409, 'Это слово уже есть в словаре');
      throw err;
    }
  };

  router.on('GET', '/api/pronunciations', () => q.list.all());

  router.on('POST', '/api/pronunciations', async ({ req, user }) => {
    requireCoordinator(user);
    const e = await entry(req);
    return unique(() => q.insert.get(e.lang, e.written, e.spoken, user.id));
  });

  router.on('PATCH', '/api/pronunciations/:id', async ({ req, params, user }) => {
    requireCoordinator(user);
    const e = await entry(req);
    const r = unique(() => q.update.run(e.lang, e.written, e.spoken, Number(params.id)));
    if (!(/** @type {any} */ (r).changes)) throw new HttpError(404, 'Не найдено');
    return { ok: true };
  });

  router.on('DELETE', '/api/pronunciations/:id', ({ params, user }) => {
    requireCoordinator(user);
    q.remove.run(Number(params.id));
    return { ok: true };
  });
}
