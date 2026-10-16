// @ts-check
// The dictionary of names: a name as the translation writes it (a transliteration: "Салвингтон") and
// another rendering of it (by its meaning: "Спасоград"), shown in place of it to those who turn it on.
// Everyone reads it, coordinators edit. `forms`: word forms that do not follow the name's own endings
// ({ "Декаполиса": "Десятиградия", … }).
import { HttpError, readJson } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function registerAliasRoutes(router, db) {
  const q = {
    list: db.prepare('SELECT id, written, alias, forms, note, source FROM name_aliases ORDER BY lower(written)'),
    insert: db.prepare('INSERT INTO name_aliases (written, alias, forms, note, source, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'),
    update: db.prepare("UPDATE name_aliases SET written = ?, alias = ?, forms = ?, note = ?, source = ?, updated_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM name_aliases WHERE id = ?'),
  };
  /** @param {import('../auth.js').User} user */
  const requireCoordinator = (user) => {
    if (!user.isCoordinator && !user.isAdmin) throw new HttpError(403, 'Словарь названий ведут координаторы');
  };
  /** @param {any} r */
  const present = (r) => ({ ...r, forms: r.forms ? JSON.parse(r.forms) : {} });
  /** @param {import('node:http').IncomingMessage} req */
  async function entry(req) {
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const text = (/** @type {unknown} */ v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const written = text(b.written);
    const alias = text(b.alias);
    if (!written || !alias) throw new HttpError(400, 'Нужны оба поля: как в переводе и как показывать');
    if (!/^[А-ЯЁA-Z][\p{L}-]*$/u.test(written)) throw new HttpError(400, 'Название в переводе — одно слово с заглавной буквы');
    /** @type {Record<string, string>} */
    const forms = {};
    if (b.forms && typeof b.forms === 'object') {
      for (const [k, v] of Object.entries(b.forms)) {
        if (typeof v === 'string' && k.trim() && v.trim()) forms[k.trim().slice(0, 80)] = v.trim().slice(0, 80);
      }
    }
    return { written, alias, forms: Object.keys(forms).length ? JSON.stringify(forms) : null, note: text(b.note, 300) || null, source: text(b.source, 120) || null };
  }
  /** @param {() => unknown} fn */
  const unique = (fn) => {
    try {
      return fn();
    } catch (err) {
      if (/UNIQUE/.test(String(err))) throw new HttpError(409, 'Это название уже есть в словаре');
      throw err;
    }
  };

  router.on('GET', '/api/aliases', () => q.list.all().map(present));

  router.on('POST', '/api/aliases', async ({ req, user }) => {
    requireCoordinator(user);
    const e = await entry(req);
    return unique(() => q.insert.get(e.written, e.alias, e.forms, e.note, e.source, user.id));
  });

  router.on('PATCH', '/api/aliases/:id', async ({ req, params, user }) => {
    requireCoordinator(user);
    const e = await entry(req);
    const r = unique(() => q.update.run(e.written, e.alias, e.forms, e.note, e.source, Number(params.id)));
    if (!(/** @type {any} */ (r).changes)) throw new HttpError(404, 'Не найдено');
    return { ok: true };
  });

  router.on('DELETE', '/api/aliases/:id', ({ params, user }) => {
    requireCoordinator(user);
    q.remove.run(Number(params.id));
    return { ok: true };
  });
}
