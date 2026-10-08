// @ts-check
// Export of the new edition and the statistics of the translation project (open to every user).
import { FileResponse, HttpError } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../translation.js').createTranslation>} tr
 * @param {ReturnType<typeof import('../export.js').createExport>} exporter
 */
export function registerExportRoutes(router, db, tr, exporter) {
  const q = {
    totals: db.prepare('SELECT status, count(*) AS n FROM proposals GROUP BY status'),
    byPaper: db.prepare(`
      SELECT pp.id, pp.title_ru AS title,
             (SELECT count(*) FROM paragraphs WHERE paper_id = pp.id) AS paragraphs,
             count(DISTINCT CASE WHEN pr.status = 'approved' THEN pr.ref END) AS changedParagraphs,
             total(pr.status = 'approved') AS approved, total(pr.status = 'voting') AS voting
      FROM papers pp JOIN paragraphs pa ON pa.paper_id = pp.id JOIN proposals pr ON pr.ref = pa.ref
      GROUP BY pp.id HAVING approved > 0 OR voting > 0 ORDER BY pp.id`),
    people: db.prepare(`
      SELECT * FROM (
        SELECT u.id, coalesce(u.display_name, u.username) AS name,
               (SELECT count(*) FROM proposals WHERE author_id = u.id AND status != 'draft') AS proposed,
               (SELECT count(*) FROM proposals WHERE author_id = u.id AND status = 'approved') AS approved,
               (SELECT count(*) FROM votes WHERE user_id = u.id) AS votes,
               (SELECT count(*) FROM public_messages WHERE author_id = u.id AND kind = 'message' AND hidden_at IS NULL) AS messages
        FROM users u
      ) WHERE proposed + votes + messages > 0
      ORDER BY approved DESC, proposed DESC, votes DESC, messages DESC`),
    book: db.prepare('SELECT count(*) AS paragraphs FROM paragraphs'),
  };

  // ?scope=all|part:N|paper:N &lang=ru|ruen &format=md|csv &changes=1
  router.on('GET', '/api/export', ({ url }) => {
    tr.sweep();
    const s = url.searchParams;
    /** @type {import('../export.js').Options} */
    const o = { scope: s.get('scope') ?? 'all', lang: s.get('lang') === 'ruen' ? 'ruen' : 'ru', changes: s.get('changes') === '1' };
    const format = s.get('format');
    if (format === 'md') {
      const f = exporter.markdown(o);
      return new FileResponse(f.name, 'text/markdown; charset=utf-8', f.body);
    }
    if (format === 'csv') {
      const f = exporter.csv(o);
      return new FileResponse(f.name, 'text/csv; charset=utf-8', f.body);
    }
    throw new HttpError(400, 'format: md или csv');
  });

  router.on('GET', '/api/public/stats', () => {
    tr.sweep();
    const totals = Object.fromEntries(/** @type {{ status: string, n: number }[]} */ (q.totals.all()).map((r) => [r.status, r.n]));
    return {
      totals: { approved: 0, voting: 0, draft: 0, rejected: 0, superseded: 0, ...totals },
      paragraphs: /** @type {{ paragraphs: number }} */ (q.book.get()).paragraphs,
      byPaper: q.byPaper.all(),
      people: q.people.all(),
    };
  });
}
