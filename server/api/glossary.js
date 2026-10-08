// @ts-check
// The translation glossary (everyone reads, coordinators edit) and hints for the translation editor.
import { HttpError, readJson } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../glossary.js').createGlossary>} glossary
 */
export function registerGlossaryRoutes(router, db, glossary) {
  const paragraph = db.prepare('SELECT plain_ru, plain_en FROM paragraphs WHERE ref = ?');
  /** @param {import('../auth.js').User} user */
  const requireCoordinator = (user) => {
    if (!user.isCoordinator && !user.isAdmin) throw new HttpError(403, 'Глоссарий ведут координаторы');
  };
  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});

  router.on('GET', '/api/glossary', () => glossary.list());

  router.on('POST', '/api/glossary', async ({ req, user }) => {
    requireCoordinator(user);
    return { id: glossary.create(await body(req), user.id) };
  });

  router.on('PATCH', '/api/glossary/:id', async ({ req, params, user }) => {
    requireCoordinator(user);
    glossary.update(Number(params.id), await body(req), user.id);
    return { ok: true };
  });

  router.on('DELETE', '/api/glossary/:id', ({ params, user }) => {
    requireCoordinator(user);
    glossary.remove(Number(params.id));
    return { ok: true };
  });

  // Hints while writing a variant: { ref, start, end, text?, proposalId? } →
  // glossary warnings for the text, glossary terms of the fragment/paragraph, translation memory.
  router.on('POST', '/api/public/assist', async ({ req }) => {
    const b = await body(req);
    const para = /** @type {{ plain_ru: string, plain_en: string } | undefined} */ (paragraph.get(String(b.ref)));
    if (!para) throw new HttpError(404, `Абзац ${b.ref} не найден`);
    const start = Number(b.start);
    const end = Number(b.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > para.plain_ru.length) {
      throw new HttpError(400, 'Неверные границы фрагмента');
    }
    const original = para.plain_ru.slice(start, end);
    const text = typeof b.text === 'string' ? b.text : original;
    const exceptId = b.proposalId === undefined || b.proposalId === null ? null : Number(b.proposalId);
    return {
      warnings: glossary.check(original, text),
      terms: glossary.termsFor(original, para.plain_en),
      memory: glossary.memory(original, exceptId),
    };
  });
}
