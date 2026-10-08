// @ts-check
// Annotations: a bookmark and/or a comment thread (with tags), attached to a fragment of one paragraph
// in one language, or to a whole paragraph. A color belongs to a bookmark on a fragment: choosing a
// color makes the note a bookmark, removing the bookmark removes the color. A bookmark without a
// name gets the first words of its sentence (shared/bookmark-title.js).
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import { normalizeTagName, hashtagsIn } from '../tags.js';
import { roleRank } from '../auth.js';
import { defaultBookmarkTitle } from '../../shared/bookmark-title.js';

const COLORS = new Set(['yellow', 'green', 'blue', 'pink', 'purple']);
const MAX_COMMENT = 20_000;

/**
 * @typedef {{
 *   id: number, ref: string, lang: 'ru' | 'en' | null, start: number | null, end: number | null,
 *   quote: string | null, color: string | null, bookmark: boolean, title: string | null, resolved: boolean,
 *   createdAt: string, updatedAt: string, paperId: number | null, sectionNum: number | null, paperTitle: string | null,
 *   comments: { id: number, body: string, createdAt: string, updatedAt: string }[], tags: string[]
 * }} Annotation
 */

/** @param {unknown} v @returns {string[]} */
function tagList(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'tags: массив имён');
  const byKey = new Map(v.map((x) => normalizeTagName(x)).map((n) => [n.toLowerCase(), n]));
  return [...byKey.values()];
}

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../tags.js').createTagStore>} tags
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 *
 * Rights: viewers read; commenters add comment threads and edit/delete their own comments;
 * editors also bookmark (with a color), tag and resolve; owners may delete anything.
 */
export function registerAnnotationRoutes(router, db, tags, auth) {
  const SELECT = `
    SELECT a.id, a.ref, a.lang, a.start_pos AS start, a.end_pos AS "end", a.quote, a.color, a.bookmark, a.title,
           a.resolved_at AS resolvedAt, a.created_at AS createdAt, a.updated_at AS updatedAt,
           a.author_id AS authorId, coalesce(ua.display_name, ua.username) AS authorName,
           p.paper_id AS paperId, p.section_num AS sectionNum, pa.title_ru AS paperTitle
    FROM annotations a
    LEFT JOIN users ua ON ua.id = a.author_id
    LEFT JOIN paragraphs p ON p.ref = a.ref
    LEFT JOIN papers pa ON pa.id = p.paper_id`;
  const ORDER = 'ORDER BY p.seq IS NULL, p.seq, a.lang IS NOT NULL, a.lang DESC, a.start_pos, a.id';
  const COMMENT = `SELECT c.id, c.annotation_id AS annotationId, c.body, c.created_at AS createdAt, c.updated_at AS updatedAt,
           c.author_id AS authorId, coalesce(u.display_name, u.username) AS authorName
    FROM comments c LEFT JOIN users u ON u.id = c.author_id`;
  const q = {
    byPaper: db.prepare(`${SELECT} WHERE a.workspace_id = ? AND p.paper_id = ? ${ORDER}`),
    all: db.prepare(`${SELECT} WHERE a.workspace_id = ? ${ORDER}`),
    one: db.prepare(`${SELECT} WHERE a.workspace_id = ? AND a.id = ?`),
    commentsAll: db.prepare(`${COMMENT} JOIN annotations a ON a.id = c.annotation_id WHERE a.workspace_id = ? ORDER BY c.id`),
    commentsOne: db.prepare(`${COMMENT} WHERE c.annotation_id = ? ORDER BY c.id`),
    commentsByPaper: db.prepare(
      `${COMMENT} JOIN annotations a ON a.id = c.annotation_id JOIN paragraphs p ON p.ref = a.ref
       WHERE a.workspace_id = ? AND p.paper_id = ? ORDER BY c.id`,
    ),
    paragraph: db.prepare('SELECT plain_ru, plain_en FROM paragraphs WHERE ref = ?'),
    insert: db.prepare(
      `INSERT INTO annotations (workspace_id, author_id, ref, lang, start_pos, end_pos, quote, color, bookmark, title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ),
    update: db.prepare(
      `UPDATE annotations SET color = ?, bookmark = ?, title = ?, resolved_at = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    ),
    raw: db.prepare('SELECT color, bookmark, title, resolved_at, author_id, ref, lang, start_pos FROM annotations WHERE id = ? AND workspace_id = ?'),
    remove: db.prepare('DELETE FROM annotations WHERE id = ? AND workspace_id = ?'),
    touch: db.prepare("UPDATE annotations SET updated_at = datetime('now') WHERE id = ?"),
    addComment: db.prepare('INSERT INTO comments (annotation_id, author_id, body) VALUES (?, ?, ?)'),
    comment: db.prepare(
      `SELECT c.id, c.author_id AS authorId FROM comments c JOIN annotations a ON a.id = c.annotation_id
       WHERE c.id = ? AND a.id = ? AND a.workspace_id = ?`,
    ),
    editComment: db.prepare("UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ?"),
    removeComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    commentCount: db.prepare('SELECT count(*) AS n FROM comments WHERE annotation_id = ?'),
    tagCount: db.prepare('SELECT count(*) AS n FROM annotation_tags WHERE annotation_id = ?'),
  };

  /**
   * Workspace id from the URL, checked against the user's role.
   * @param {Record<string, string>} params @param {import('../auth.js').User} user @param {import('../auth.js').Role} min
   */
  const access = (params, user, min) => {
    const ws = Number(params.id);
    return { ws, role: auth.require(ws, user, min) };
  };
  /** @param {number} ws @param {number} id */
  const rawNote = (ws, id) => {
    const cur = /** @type {{ color: string | null, bookmark: number, title: string | null, resolved_at: string | null, author_id: number | null, ref: string, lang: 'ru' | 'en' | null, start_pos: number | null } | undefined} */ (
      q.raw.get(id, ws)
    );
    if (!cur) throw new HttpError(404, 'Заметка не найдена');
    return cur;
  };

  /**
   * @param {any[]} rows @param {any[]} comments
   * @param {Map<number, { name: string }[]>} tagMap
   * @returns {Annotation[]}
   */
  const assemble = (rows, comments, tagMap) => {
    const byId = Map.groupBy(comments, (c) => c.annotationId);
    return rows.map((r) => ({
      ...r,
      bookmark: Boolean(r.bookmark),
      resolved: r.resolvedAt !== null,
      resolvedAt: undefined,
      comments: (byId.get(r.id) ?? []).map(({ annotationId, ...c }) => c),
      tags: (tagMap.get(r.id) ?? []).map((t) => t.name),
    }));
  };

  /** @param {number} ws @param {number} id */
  const fetchOne = (ws, id) => {
    const row = q.one.get(ws, id);
    if (!row) throw new HttpError(404, 'Заметка не найдена');
    return assemble([row], q.commentsOne.all(id), new Map([[id, tags.namesOf(id).map((name) => ({ name }))]]))[0];
  };

  /** An annotation with nothing left (no color, bookmark, comments or tags) is removed. */
  const pruneIfEmpty = (/** @type {number} */ ws, /** @type {number} */ id) => {
    const raw = /** @type {{ color: string | null, bookmark: number } | undefined} */ (q.raw.get(id, ws));
    const n =
      /** @type {{ n: number }} */ (q.commentCount.get(id)).n + /** @type {{ n: number }} */ (q.tagCount.get(id)).n;
    if (raw && !raw.color && !raw.bookmark && n === 0) {
      q.remove.run(id, ws);
      return true;
    }
    return false;
  };

  /** @param {unknown} v */
  const commentBody = (v) => {
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'Пустой комментарий');
    if (v.length > MAX_COMMENT) throw new HttpError(400, `Комментарий длиннее ${MAX_COMMENT} символов`);
    return v.trim();
  };
  /** @param {unknown} v */
  const color = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string' || !COLORS.has(v)) throw new HttpError(400, 'Неизвестный цвет');
    return v;
  };
  /** @param {unknown} v */
  const title = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string' || v.length > 300) throw new HttpError(400, 'Название закладки: строка до 300 символов');
    return v.trim() || null;
  };
  /** A bookmark's name when none is given: the first words of its sentence. @param {string} ref @param {string | null} lang @param {number | null} start */
  const titleFor = (ref, lang, start) => {
    const p = /** @type {{ plain_ru: string, plain_en: string } | undefined} */ (q.paragraph.get(ref));
    return p ? defaultBookmarkTitle(lang === 'en' ? p.plain_en : p.plain_ru, start ?? 0) || null : null;
  };
  /** Hashtags in a comment become tags only for those allowed to tag. @param {import('../auth.js').Role} role @param {string} body */
  const autoTags = (role, body) => (roleRank(role) >= roleRank('editor') ? hashtagsIn(body) : []);
  /** @param {import('../auth.js').Role} role */
  const requireEditor = (role) => {
    if (roleRank(role) < roleRank('editor')) throw new HttpError(403, 'Закладки и теги доступны редакторам');
  };

  // Notes from before "a color belongs to a bookmark": a colored note becomes a bookmark, and every
  // bookmark gets a name (the first words of its sentence) if it had none.
  for (const r of /** @type {{ id: number, ref: string, lang: 'ru' | 'en' | null, start_pos: number | null, title: string | null }[]} */ (
    db.prepare("SELECT id, ref, lang, start_pos, title FROM annotations WHERE (color IS NOT NULL AND bookmark = 0) OR (bookmark = 1 AND trim(coalesce(title, '')) = '')").all()
  )) {
    db.prepare('UPDATE annotations SET bookmark = 1, title = ? WHERE id = ?').run(r.title?.trim() || titleFor(r.ref, r.lang, r.start_pos), r.id);
  }

  router.on('GET', '/api/workspaces/:id/annotations', ({ params, url, user }) => {
    const { ws } = access(params, user, 'viewer');
    const paper = url.searchParams.get('paper');
    const tagMap = tags.namesByAnnotation(ws);
    if (paper !== null) {
      return assemble(q.byPaper.all(ws, Number(paper)), q.commentsByPaper.all(ws, Number(paper)), tagMap);
    }
    return assemble(q.all.all(ws), q.commentsAll.all(ws), tagMap);
  });

  // Body: { ref, lang?, start?, end?, color?, bookmark?, title?, comment?, tags? }
  router.on('POST', '/api/workspaces/:id/annotations', async ({ req, params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const para = /** @type {{ plain_ru: string, plain_en: string } | undefined} */ (q.paragraph.get(String(b.ref)));
    if (!para) throw new HttpError(400, `Абзац ${b.ref} не найден`);

    /** @type {[string | null, number | null, number | null, string | null]} */
    let anchor = [null, null, null, null];
    if (b.lang !== undefined && b.lang !== null) {
      if (b.lang !== 'ru' && b.lang !== 'en') throw new HttpError(400, 'lang: ru или en');
      const text = b.lang === 'ru' ? para.plain_ru : para.plain_en;
      const start = Number(b.start);
      const end = Number(b.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
        throw new HttpError(400, 'Неверные границы выделения');
      }
      anchor = [b.lang, start, end, text.slice(start, end)];
    }
    // A color only on a fragment, and a color makes a bookmark.
    const c = anchor[0] ? color(b.color) : null;
    const bookmark = b.bookmark === true || c !== null;
    const comment = b.comment === undefined ? null : commentBody(b.comment);
    const explicitTags = tagList(b.tags);
    if (c || bookmark || explicitTags.length) requireEditor(role);
    const tagNames = [...explicitTags, ...(comment ? autoTags(role, comment) : [])];
    if (!c && !bookmark && !comment && !tagNames.length) throw new HttpError(400, 'Нужен цвет, закладка, комментарий или тег');

    const id = transaction(db, () => {
      const row = /** @type {{ id: number }} */ (
        q.insert.get(ws, user.id, String(b.ref), ...anchor, c, bookmark ? 1 : 0, bookmark ? title(b.title) ?? titleFor(String(b.ref), anchor[0], anchor[1]) : null)
      );
      if (comment) q.addComment.run(row.id, user.id, comment);
      tags.add(ws, row.id, tagNames);
      return row.id;
    });
    return fetchOne(ws, id);
  });

  // Replaces the tag set: { tags: string[] }
  router.on('PUT', '/api/workspaces/:id/annotations/:aid/tags', async ({ req, params, user }) => {
    const { ws } = access(params, user, 'editor');
    const id = Number(params.aid);
    rawNote(ws, id);
    const names = tagList(/** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {}).tags);
    transaction(db, () => {
      tags.set(ws, id, names);
      q.touch.run(id);
    });
    if (pruneIfEmpty(ws, id)) return { id, deleted: true };
    return fetchOne(ws, id);
  });

  // Body: any of { color, bookmark, title, resolved }
  router.on('PATCH', '/api/workspaces/:id/annotations/:aid', async ({ req, params, user }) => {
    const { ws } = access(params, user, 'editor');
    const id = Number(params.aid);
    const cur = rawNote(ws, id);
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const resolvedAt =
      b.resolved === undefined ? cur.resolved_at : b.resolved ? cur.resolved_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    let nextColor = 'color' in b ? (cur.lang ? color(b.color) : null) : cur.color;
    let bookmark = 'bookmark' in b ? Boolean(b.bookmark) : Boolean(cur.bookmark);
    if ('color' in b && nextColor) bookmark = true; // a color makes a bookmark
    if (!bookmark) nextColor = null; // no bookmark — no color
    let nextTitle = 'title' in b ? title(b.title) : cur.title;
    if (!bookmark) nextTitle = null;
    else if (!nextTitle) nextTitle = titleFor(cur.ref, cur.lang, cur.start_pos);
    q.update.run(nextColor, bookmark ? 1 : 0, nextTitle, resolvedAt, id, ws);
    if (pruneIfEmpty(ws, id)) return { id, deleted: true };
    return fetchOne(ws, id);
  });

  // Owners delete any note; editors their own.
  router.on('DELETE', '/api/workspaces/:id/annotations/:aid', ({ params, user }) => {
    const { ws, role } = access(params, user, 'editor');
    const id = Number(params.aid);
    const cur = rawNote(ws, id);
    if (role !== 'owner' && cur.author_id !== user.id) throw new HttpError(403, 'Чужую заметку может удалить только владелец пространства');
    q.remove.run(id, ws);
    return { id, deleted: true };
  });

  router.on('POST', '/api/workspaces/:id/annotations/:aid/comments', async ({ req, params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const id = Number(params.aid);
    rawNote(ws, id);
    const body = commentBody(/** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {}).body);
    transaction(db, () => {
      q.addComment.run(id, user.id, body);
      tags.add(ws, id, autoTags(role, body));
      q.touch.run(id);
    });
    return fetchOne(ws, id);
  });

  /** A comment that the user may change: own comments; owners may also delete others'. */
  const ownComment = (/** @type {number} */ ws, /** @type {number} */ id, /** @type {number} */ cid) => {
    const c = /** @type {{ authorId: number | null } | undefined} */ (q.comment.get(cid, id, ws));
    if (!c) throw new HttpError(404, 'Комментарий не найден');
    return c;
  };

  router.on('PATCH', '/api/workspaces/:id/annotations/:aid/comments/:cid', async ({ req, params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const id = Number(params.aid);
    const c = ownComment(ws, id, Number(params.cid));
    if (c.authorId !== user.id) throw new HttpError(403, 'Изменять можно только свои комментарии');
    const body = commentBody(/** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {}).body);
    transaction(db, () => {
      q.editComment.run(body, Number(params.cid));
      tags.add(ws, id, autoTags(role, body));
      q.touch.run(id);
    });
    return fetchOne(ws, id);
  });

  router.on('DELETE', '/api/workspaces/:id/annotations/:aid/comments/:cid', ({ params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const id = Number(params.aid);
    const c = ownComment(ws, id, Number(params.cid));
    if (c.authorId !== user.id && role !== 'owner') throw new HttpError(403, 'Чужой комментарий может удалить только владелец');
    q.removeComment.run(Number(params.cid));
    if (pruneIfEmpty(ws, id)) return { id, deleted: true };
    q.touch.run(id);
    return fetchOne(ws, id);
  });
}

