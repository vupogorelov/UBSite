// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpError, FileResponse } from '../http.js';

/** The project's about.md, shown on the "О приложении" page (read on every request: edits show at once). */
const ABOUT = fileURLToPath(new URL('../../about.md', import.meta.url));
/** Its pictures: the about/ folder next to it (about.md refers to them as about/name.webp → /api/about/name.webp). */
const ABOUT_FILES = fileURLToPath(new URL('../../about/', import.meta.url));
const IMAGE_TYPES = /** @type {Record<string, string>} */ ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' });

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function registerBookRoutes(router, db) {
  const q = {
    parts: db.prepare('SELECT id, title_ru AS titleRu, title_en AS titleEn, subtitle_ru AS subtitleRu, subtitle_en AS subtitleEn FROM parts ORDER BY id'),
    // `paragraphs`: how many — the audio reader's progress through the whole book.
    papers: db.prepare(
      `SELECT id, part_id AS partId, title_ru AS titleRu, title_en AS titleEn,
         (SELECT count(*) FROM paragraphs WHERE paper_id = papers.id) AS paragraphs
       FROM papers ORDER BY id`,
    ),
    sections: db.prepare(
      'SELECT paper_id AS paperId, num, title_ru AS titleRu, title_en AS titleEn FROM sections WHERE num > 0 ORDER BY paper_id, num',
    ),
    paper: db.prepare(
      `SELECT p.id, p.title_ru AS titleRu, p.title_en AS titleEn, p.part_id AS partId, pt.title_ru AS partTitleRu, pt.title_en AS partTitleEn,
              pt.subtitle_ru AS partIntroRu, pt.subtitle_en AS partIntroEn,
              p.id > 0 AND p.id = (SELECT min(x.id) FROM papers x WHERE x.part_id = p.part_id AND x.id > 0) AS partStart
       FROM papers p JOIN parts pt ON pt.id = p.part_id WHERE p.id = ?`,
    ),
    paperSections: db.prepare(
      'SELECT num, title_ru AS titleRu, title_en AS titleEn FROM sections WHERE paper_id = ? ORDER BY num',
    ),
    paperParagraphs: db.prepare(
      `SELECT ref, section_num AS sectionNum, page_ref AS pageRef, html_ru AS ru, html_en AS en
       FROM paragraphs WHERE paper_id = ? ORDER BY seq`,
    ),
    lastPaper: db.prepare('SELECT max(id) AS id FROM papers'),
    sectionExists: db.prepare('SELECT 1 FROM sections WHERE paper_id = ? AND num = ?'),
    refExists: db.prepare('SELECT 1 FROM paragraphs WHERE ref = ?'),
    byPage: db.prepare('SELECT ref FROM paragraphs WHERE page_ref = ?'),
    stemAliases: db.prepare("SELECT value FROM meta WHERE key = 'ru_stem_aliases'"),
  };

  /** @type {unknown} */
  let tocCache = null; // book text changes only on re-import; restart the server afterwards
  router.on('GET', '/api/about', () => {
    try {
      return { markdown: readFileSync(ABOUT, 'utf8') };
    } catch {
      throw new HttpError(404, 'Файл about.md не найден');
    }
  });

  router.on('GET', '/api/about/:name', ({ params }) => {
    // a plain file name only (no folders): letters, digits, "_", "-", "."
    const m = String(params.name).match(/^[\w-]+(?:\.[\w-]+)*\.(png|jpe?g|webp|gif|svg)$/i);
    if (!m) throw new HttpError(404, 'Не найдено');
    try {
      return new FileResponse(params.name, IMAGE_TYPES[m[1].toLowerCase()], readFileSync(ABOUT_FILES + params.name), true);
    } catch {
      throw new HttpError(404, 'Не найдено');
    }
  });

  router.on('GET', '/api/toc', () => {
    tocCache ??= { parts: q.parts.all(), papers: q.papers.all(), sections: q.sections.all() };
    return tocCache;
  });

  router.on('GET', '/api/papers/:id', ({ params }) => {
    const id = Number(params.id);
    const paper = Number.isInteger(id) ? q.paper.get(id) : undefined;
    if (!paper) throw new HttpError(404, `Текст ${params.id} не найден`);
    const last = /** @type {{ id: number }} */ (q.lastPaper.get()).id;
    return {
      paper,
      sections: q.paperSections.all(id),
      paragraphs: q.paperParagraphs.all(id),
      prev: id > 0 ? id - 1 : null,
      next: id < last ? id + 1 : null,
    };
  });

  // The Russian stem merges (fleeting vowels: отец/отца) the search index uses: [long, short][] —
  // the device's search without a network splits words exactly as the server's (shared/search/text.js).
  router.on('GET', '/api/stem-aliases', () => JSON.parse(/** @type {{ value: string } | undefined} */ (q.stemAliases.get())?.value ?? '[]'));

  // Resolves "5", "5:1", "5:1.3" or a page reference "62.3" / "(62.3)" into an app path.
  router.on('GET', '/api/goto', ({ url }) => {
    const text = (url.searchParams.get('q') ?? '').trim();
    let m;
    if ((m = text.match(/^(\d+)(?::(\d+)(?:\.(\d+))?)?$/))) {
      const [, p, s, n] = m;
      if (n !== undefined && q.refExists.get(`${+p}:${+s}.${+n}`)) return { path: `/${+p}:${+s}.${+n}` };
      if (n === undefined && s !== undefined && q.sectionExists.get(+p, +s)) return { path: `/${+p}:${+s}` };
      if (s === undefined && q.paper.get(+p)) return { path: `/${+p}` };
    } else if ((m = text.match(/^\(?(\d+)\.(\d+)\)?$/))) {
      const row = /** @type {{ ref: string } | undefined} */ (q.byPage.get(`${+m[1]}.${+m[2]}`));
      if (row) return { path: `/${row.ref}` };
    }
    throw new HttpError(404, `Не найдено: «${text}»`);
  });
}
