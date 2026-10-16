// @ts-check
// Annotations: a bookmark and/or a comment thread (with tags), attached to a fragment of one paragraph
// in one language, or to a whole paragraph. A color belongs to a bookmark on a fragment: choosing a
// color makes the note a bookmark, removing the bookmark removes the color. A bookmark without a
// name gets the first words of its sentence (shared/bookmark-title.js).
// The comments are the note's conversation in the common chat model: public_messages with the key
// "note:<id>" (server/chat.js) — replies, reactions, @mentions, live updates, notifications.
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
 * @param {ReturnType<typeof import('../chat.js').createChat>} chat
 *
 * Rights: viewers read; commenters add comment threads and edit/delete their own comments;
 * editors also bookmark (with a color), tag and resolve; owners may delete anything.
 */
export function registerAnnotationRoutes(router, db, tags, auth, chat) {
  const SELECT = `
    SELECT a.id, a.uid, a.ref, a.lang, a.start_pos AS start, a.end_pos AS "end", a.quote, a.color, a.bookmark, a.title,
           a.resolved_at AS resolvedAt, a.created_at AS createdAt, a.updated_at AS updatedAt,
           a.author_id AS authorId, coalesce(ua.display_name, ua.username) AS authorName,
           p.paper_id AS paperId, p.section_num AS sectionNum, pa.title_ru AS paperTitle
    FROM annotations a
    LEFT JOIN users ua ON ua.id = a.author_id
    LEFT JOIN paragraphs p ON p.ref = a.ref
    LEFT JOIN papers pa ON pa.id = p.paper_id`;
  const ORDER = 'ORDER BY p.seq IS NULL, p.seq, a.lang IS NOT NULL, a.lang DESC, a.start_pos, a.id';
  // A note's comments: its conversation's messages (the same columns as server/chat.js gives).
  const COMMENT = `SELECT m.id, a.id AS annotationId, m.ref AS chat, m.kind, m.body, m.created_at AS createdAt, m.updated_at AS updatedAt,
           m.author_id AS authorId, coalesce(u.display_name, u.username) AS authorName, u.username AS authorUsername,
           m.hidden_at AS hiddenAt, m.reply_to AS replyTo, m.proposal_id AS proposalId
    FROM annotations a JOIN public_messages m ON m.ref = 'note:' || a.id LEFT JOIN users u ON u.id = m.author_id`;
  const q = {
    byPaper: db.prepare(`${SELECT} WHERE a.workspace_id = ? AND p.paper_id = ? ${ORDER}`),
    all: db.prepare(`${SELECT} WHERE a.workspace_id = ? ${ORDER}`),
    one: db.prepare(`${SELECT} WHERE a.workspace_id = ? AND a.id = ?`),
    commentsAll: db.prepare(`${COMMENT} WHERE a.workspace_id = ? ORDER BY m.id`),
    commentsOne: db.prepare(`${COMMENT} WHERE a.id = ? ORDER BY m.id`),
    commentsByPaper: db.prepare(
      `${COMMENT} JOIN paragraphs p ON p.ref = a.ref WHERE a.workspace_id = ? AND p.paper_id = ? ORDER BY m.id`,
    ),
    paragraph: db.prepare('SELECT plain_ru, plain_en FROM paragraphs WHERE ref = ?'),
    insert: db.prepare(
      `INSERT INTO annotations (workspace_id, author_id, ref, lang, start_pos, end_pos, quote, color, bookmark, title, uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ),
    byUid: db.prepare('SELECT id FROM annotations WHERE workspace_id = ? AND uid = ?'),
    // the feed of changes (migration 34)
    feedTop: db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'"),
    feedMin: db.prepare('SELECT min(seq) AS seq FROM changes'),
    feedNotes: db.prepare("SELECT DISTINCT entity_id AS id FROM changes WHERE workspace_id = ? AND entity = 'note' AND seq > ? AND seq <= ?"),
    feedPurge: db.prepare("DELETE FROM changes WHERE at < datetime('now', '-60 days')"),
    update: db.prepare(
      `UPDATE annotations SET color = ?, bookmark = ?, title = ?, resolved_at = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    ),
    raw: db.prepare('SELECT color, bookmark, title, resolved_at, author_id, ref, lang, start_pos FROM annotations WHERE id = ? AND workspace_id = ?'),
    remove: db.prepare('DELETE FROM annotations WHERE id = ? AND workspace_id = ?'),
    touch: db.prepare("UPDATE annotations SET updated_at = datetime('now') WHERE id = ?"),
    comment: db.prepare(
      `SELECT m.id, m.author_id AS authorId FROM public_messages m JOIN annotations a ON m.ref = 'note:' || a.id
       WHERE m.id = ? AND a.id = ? AND a.workspace_id = ? AND m.kind = 'message'`,
    ),
    editComment: db.prepare("UPDATE public_messages SET body = ?, updated_at = datetime('now') WHERE id = ?"),
    removeComment: db.prepare('DELETE FROM public_messages WHERE id = ?'),
    commentCount: db.prepare("SELECT count(*) AS n FROM public_messages WHERE ref = ? AND kind = 'message'"),
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
  /**
   * The note in the URL: its number, or "u-<uid>" — the id its device gave it (a note made without a
   * network is addressed so before the device learns its number).
   * @param {number} ws @param {string} aid
   */
  const noteId = (ws, aid) => {
    const m = String(aid).match(/^u-([\w-]{8,64})$/);
    if (!m) return Number(aid);
    const row = /** @type {{ id: number } | undefined} */ (q.byUid.get(ws, m[1]));
    if (!row) throw new HttpError(404, 'Заметка не найдена');
    return row.id;
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
   * Notes with their comments (as chat messages: replies and reactions included) and tags.
   * @param {any[]} rows @param {any[]} comments
   * @param {Map<number, { name: string }[]>} tagMap @param {import('../auth.js').User} user
   * @returns {Annotation[]}
   */
  const assemble = (rows, comments, tagMap, user) => {
    const byId = Map.groupBy(chat.present(comments, user), (c) => c.annotationId);
    return rows.map((r) => ({
      ...r,
      bookmark: Boolean(r.bookmark),
      resolved: r.resolvedAt !== null,
      resolvedAt: undefined,
      comments: (byId.get(r.id) ?? []).map(({ annotationId, ...c }) => c),
      tags: (tagMap.get(r.id) ?? []).map((t) => t.name),
    }));
  };

  /** @param {number} ws @param {number} id @param {import('../auth.js').User} user */
  const fetchOne = (ws, id, user) => {
    const row = q.one.get(ws, id);
    if (!row) throw new HttpError(404, 'Заметка не найдена');
    return assemble([row], q.commentsOne.all(id), new Map([[id, tags.namesOf(id).map((name) => ({ name }))]]), user)[0];
  };

  /** An annotation with nothing left (no color, bookmark, comments or tags) is removed. */
  const pruneIfEmpty = (/** @type {number} */ ws, /** @type {number} */ id) => {
    const raw = /** @type {{ color: string | null, bookmark: number } | undefined} */ (q.raw.get(id, ws));
    const n =
      /** @type {{ n: number }} */ (q.commentCount.get(`note:${id}`)).n + /** @type {{ n: number }} */ (q.tagCount.get(id)).n;
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
      return assemble(q.byPaper.all(ws, Number(paper)), q.commentsByPaper.all(ws, Number(paper)), tagMap, user);
    }
    return assemble(q.all.all(ws), q.commentsAll.all(ws), tagMap, user);
  });

  // The feed: what changed in the workspace's notes after `since` (the last `seq` the device has) —
  // { seq, reset, notes, deleted }. No `since` (the first time), or so far behind that the feed no longer
  // reaches it, or ahead of it (another database): every note anew (reset). The device keeps the notes and asks again (web/src/lib/feed.js).
  let purgedAt = 0;
  router.on('GET', '/api/workspaces/:id/changes', ({ params, url, user }) => {
    const { ws } = access(params, user, 'viewer');
    if (Date.now() - purgedAt > 3600_000) {
      purgedAt = Date.now();
      q.feedPurge.run();
    }
    const given = url.searchParams.get('since');
    const since = Math.max(0, Number(given) || 0);
    const seq = /** @type {{ seq: number } | undefined} */ (q.feedTop.get())?.seq ?? 0;
    const oldest = /** @type {{ seq: number | null }} */ (q.feedMin.get()).seq ?? seq + 1;
    if (given === null || since < oldest - 1 || since > seq) {
      return { seq, reset: true, notes: assemble(q.all.all(ws), q.commentsAll.all(ws), tags.namesByAnnotation(ws), user), deleted: [] };
    }
    /** @type {Annotation[]} */
    const notes = [];
    /** @type {number[]} */
    const deleted = [];
    for (const { id } of /** @type {{ id: number }[]} */ (q.feedNotes.all(ws, since, seq))) {
      if (q.one.get(ws, id)) notes.push(fetchOne(ws, id, user));
      else deleted.push(id);
    }
    return { seq, reset: false, notes, deleted };
  });

  // Body: { ref, lang?, start?, end?, color?, bookmark?, title?, comment?, tags?, uid? }
  // `uid`: the note's id from the device that made it; the same uid again is the same note.
  router.on('POST', '/api/workspaces/:id/annotations', async ({ req, params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const uid = b.uid === undefined || b.uid === null ? null : String(b.uid);
    if (uid !== null && !/^[\w-]{8,64}$/.test(uid)) throw new HttpError(400, 'uid: 8–64 букв, цифр, «-», «_»');
    const known = uid === null ? undefined : /** @type {{ id: number } | undefined} */ (q.byUid.get(ws, uid));
    if (known) return fetchOne(ws, known.id, user);
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
        q.insert.get(ws, user.id, String(b.ref), ...anchor, c, bookmark ? 1 : 0, bookmark ? title(b.title) ?? titleFor(String(b.ref), anchor[0], anchor[1]) : null, uid)
      );
      if (comment) chat.post(`note:${row.id}`, user, { body: comment });
      tags.add(ws, row.id, tagNames);
      return row.id;
    });
    return fetchOne(ws, id, user);
  });

  // Replaces the tag set: { tags: string[] }
  router.on('PUT', '/api/workspaces/:id/annotations/:aid/tags', async ({ req, params, user }) => {
    const { ws } = access(params, user, 'editor');
    const id = noteId(ws, params.aid);
    rawNote(ws, id);
    const names = tagList(/** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {}).tags);
    transaction(db, () => {
      tags.set(ws, id, names);
      q.touch.run(id);
    });
    if (pruneIfEmpty(ws, id)) return { id, deleted: true };
    return fetchOne(ws, id, user);
  });

  // Body: any of { color, bookmark, title, resolved }
  router.on('PATCH', '/api/workspaces/:id/annotations/:aid', async ({ req, params, user }) => {
    const { ws } = access(params, user, 'editor');
    const id = noteId(ws, params.aid);
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
    return fetchOne(ws, id, user);
  });

  // Owners delete any note; editors their own.
  router.on('DELETE', '/api/workspaces/:id/annotations/:aid', ({ params, user }) => {
    const { ws, role } = access(params, user, 'editor');
    const id = noteId(ws, params.aid);
    const cur = rawNote(ws, id);
    if (role !== 'owner' && cur.author_id !== user.id) throw new HttpError(403, 'Чужую заметку может удалить только владелец пространства');
    q.remove.run(id, ws);
    return { id, deleted: true };
  });

  // { body, replyTo? } — a message in the note's conversation
  router.on('POST', '/api/workspaces/:id/annotations/:aid/comments', async ({ req, params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const id = noteId(ws, params.aid);
    rawNote(ws, id);
    const b = /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
    const body = commentBody(b.body);
    transaction(db, () => {
      chat.post(`note:${id}`, user, { body, replyTo: b.replyTo });
      tags.add(ws, id, autoTags(role, body));
      q.touch.run(id);
    });
    return fetchOne(ws, id, user);
  });

  /** A comment that the user may change: own comments; owners may also delete others'. */
  const ownComment = (/** @type {number} */ ws, /** @type {number} */ id, /** @type {number} */ cid) => {
    const c = /** @type {{ authorId: number | null } | undefined} */ (q.comment.get(cid, id, ws));
    if (!c) throw new HttpError(404, 'Комментарий не найден');
    return c;
  };

  router.on('PATCH', '/api/workspaces/:id/annotations/:aid/comments/:cid', async ({ req, params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const id = noteId(ws, params.aid);
    const c = ownComment(ws, id, Number(params.cid));
    if (c.authorId !== user.id) throw new HttpError(403, 'Изменять можно только свои комментарии');
    const body = commentBody(/** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {}).body);
    transaction(db, () => {
      q.editComment.run(body, Number(params.cid));
      tags.add(ws, id, autoTags(role, body));
      q.touch.run(id);
    });
    chat.edited(Number(params.cid), user); // mentions and live update
    return fetchOne(ws, id, user);
  });

  router.on('DELETE', '/api/workspaces/:id/annotations/:aid/comments/:cid', ({ params, user }) => {
    const { ws, role } = access(params, user, 'commenter');
    const id = noteId(ws, params.aid);
    const c = ownComment(ws, id, Number(params.cid));
    if (c.authorId !== user.id && role !== 'owner') throw new HttpError(403, 'Чужой комментарий может удалить только владелец');
    q.removeComment.run(Number(params.cid));
    chat.deleted(`note:${id}`, Number(params.cid));
    if (pruneIfEmpty(ws, id)) return { id, deleted: true };
    q.touch.run(id);
    return fetchOne(ws, id, user);
  });
}

