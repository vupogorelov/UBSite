// @ts-check
// Collections ("подборки"): hand-ordered lists of paragraphs, notes and text blocks in a workspace.
// Members of the workspace read them (viewers) and change them (editors). A shared collection is
// readable by every user of the platform — including the notes in it, and only those — and may be
// subscribed to (read-only, always current) or copied into one's own workspace.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import { roleRank } from '../auth.js';

const MAX_TITLE = 200;
const MAX_BODY = 20_000;
const MAX_RANGE = 60; // paragraphs in one item

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 */
export function registerCollectionRoutes(router, db, auth) {
  const META = `
    SELECT c.id, c.workspace_id AS workspaceId, c.title, c.description, c.shared, c.author_id AS authorId,
           coalesce(u.display_name, u.username) AS authorName, w.name AS workspaceName, w.kind AS workspaceKind,
           c.copied_from AS copiedFrom, c.created_at AS createdAt, c.updated_at AS updatedAt,
           (SELECT count(*) FROM collection_items WHERE collection_id = c.id) AS items
    FROM collections c JOIN workspaces w ON w.id = c.workspace_id LEFT JOIN users u ON u.id = c.author_id`;
  const q = {
    byWorkspace: db.prepare(`${META} WHERE c.workspace_id = ? ORDER BY c.updated_at DESC`),
    subscribed: db.prepare(`${META} JOIN collection_subscriptions s ON s.collection_id = c.id AND s.user_id = ? WHERE c.shared = 1 ORDER BY c.title`),
    sharedAll: db.prepare(`${META} WHERE c.shared = 1 ORDER BY c.updated_at DESC LIMIT 200`),
    meta: db.prepare(`${META} WHERE c.id = ?`),
    insert: db.prepare('INSERT INTO collections (workspace_id, title, description, author_id, copied_from) VALUES (?, ?, ?, ?, ?) RETURNING id'),
    update: db.prepare("UPDATE collections SET title = ?, description = ?, shared = ?, updated_at = datetime('now') WHERE id = ?"),
    touch: db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM collections WHERE id = ?'),
    items: db.prepare(`
      SELECT id, kind, ref, ref_end AS refEnd, annotation_id AS annotationId, body, heading
      FROM collection_items WHERE collection_id = ? ORDER BY pos, id`),
    item: db.prepare('SELECT id FROM collection_items WHERE id = ? AND collection_id = ?'),
    maxPos: db.prepare('SELECT coalesce(max(pos), 0) AS pos FROM collection_items WHERE collection_id = ?'),
    shiftFrom: db.prepare('UPDATE collection_items SET pos = pos + 1 WHERE collection_id = ? AND pos > ?'),
    posOf: db.prepare('SELECT pos FROM collection_items WHERE id = ? AND collection_id = ?'),
    addItem: db.prepare(
      'INSERT INTO collection_items (collection_id, pos, kind, ref, ref_end, annotation_id, body, heading) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    ),
    editItem: db.prepare('UPDATE collection_items SET body = ?, heading = ? WHERE id = ?'),
    removeItem: db.prepare('DELETE FROM collection_items WHERE id = ?'),
    setPos: db.prepare('UPDATE collection_items SET pos = ? WHERE id = ? AND collection_id = ?'),
    para: db.prepare('SELECT ref, seq, paper_id AS paperId FROM paragraphs WHERE ref = ?'),
    range: db.prepare(`
      SELECT p.ref, p.page_ref AS pageRef, p.html_ru AS ru, p.html_en AS en, p.paper_id AS paperId, pp.title_ru AS paperTitle
      FROM paragraphs p JOIN papers pp ON pp.id = p.paper_id
      WHERE p.seq BETWEEN (SELECT seq FROM paragraphs WHERE ref = ?) AND (SELECT seq FROM paragraphs WHERE ref = ?) ORDER BY p.seq`),
    note: db.prepare(`
      SELECT a.id, a.ref, a.lang, a.start_pos AS start, a.end_pos AS "end", a.quote, a.color, a.bookmark, a.title,
             coalesce(u.display_name, u.username) AS authorName
      FROM annotations a LEFT JOIN users u ON u.id = a.author_id WHERE a.id = ?`),
    noteInWs: db.prepare('SELECT id, ref FROM annotations WHERE id = ? AND workspace_id = ?'),
    noteComments: db.prepare(`
      SELECT c.id, c.body, c.created_at AS createdAt, coalesce(u.display_name, u.username) AS authorName
      FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.annotation_id = ? ORDER BY c.id`),
    noteTags: db.prepare('SELECT t.name FROM annotation_tags at JOIN tags t ON t.id = at.tag_id WHERE at.annotation_id = ? ORDER BY t.name'),
    isSubscribed: db.prepare('SELECT 1 AS yes FROM collection_subscriptions WHERE user_id = ? AND collection_id = ?'),
    subscribe: db.prepare('INSERT OR IGNORE INTO collection_subscriptions (user_id, collection_id) VALUES (?, ?)'),
    unsubscribe: db.prepare('DELETE FROM collection_subscriptions WHERE user_id = ? AND collection_id = ?'),
  };

  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
  /** @param {unknown} v @param {string} what @param {number} max */
  const text = (v, what, max) => {
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${what}: пусто`);
    if (v.length > max) throw new HttpError(400, `${what}: длиннее ${max} символов`);
    return v.trim();
  };
  /** @param {unknown} v */
  const optional = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_BODY) : null);

  /**
   * The collection and what the user may do with it: members of its workspace by their role;
   * anyone else reads a shared one.
   * @param {number} id @param {import('../auth.js').User} user
   */
  function load(id, user) {
    const c = /** @type {any} */ (q.meta.get(id));
    const role = c ? auth.role(c.workspaceId, user.id) : null;
    if (!c || (!role && !c.shared)) throw new HttpError(404, 'Подборка не найдена');
    return { c, role, canEdit: !!role && roleRank(role) >= roleRank('editor') };
  }
  /** @param {number} id @param {import('../auth.js').User} user */
  function editable(id, user) {
    const r = load(id, user);
    if (!r.canEdit) throw new HttpError(403, 'Менять подборку могут редакторы её пространства');
    return r.c;
  }
  /** @param {any} c */
  const present = (c) => ({ ...c, shared: !!c.shared });

  /** Items with their content: paragraphs (HTML), notes with comments and tags. @param {number} id */
  function items(id) {
    return /** @type {any[]} */ (q.items.all(id)).map((it) => {
      const out = { ...it, heading: !!it.heading };
      if (it.kind === 'para') out.paragraphs = q.range.all(it.ref, it.refEnd ?? it.ref);
      if (it.kind === 'note') {
        const n = /** @type {any} */ (q.note.get(it.annotationId));
        out.note = n && {
          ...n,
          bookmark: !!n.bookmark,
          comments: q.noteComments.all(n.id),
          tags: /** @type {{ name: string }[]} */ (q.noteTags.all(n.id)).map((t) => t.name),
        };
        out.paragraphs = n ? q.range.all(n.ref, n.ref) : [];
      }
      return out;
    });
  }

  /** Validated item fields from a request body. @param {Record<string, unknown>} b @param {number} ws */
  function itemFields(b, ws) {
    const kind = b.kind;
    if (kind === 'para') {
      const first = /** @type {any} */ (q.para.get(String(b.ref)));
      if (!first) throw new HttpError(400, `Абзац ${b.ref} не найден`);
      let refEnd = null;
      if (b.refEnd !== undefined && b.refEnd !== null && b.refEnd !== b.ref) {
        const last = /** @type {any} */ (q.para.get(String(b.refEnd)));
        if (!last) throw new HttpError(400, `Абзац ${b.refEnd} не найден`);
        if (last.seq < first.seq) throw new HttpError(400, 'Конец диапазона раньше начала');
        if (last.seq - first.seq >= MAX_RANGE) throw new HttpError(400, `Диапазон длиннее ${MAX_RANGE} абзацев`);
        refEnd = last.ref;
      }
      return { kind, ref: first.ref, refEnd, annotationId: null, body: optional(b.body), heading: 0 };
    }
    if (kind === 'note') {
      const n = /** @type {any} */ (q.noteInWs.get(Number(b.annotationId), ws));
      if (!n) throw new HttpError(400, 'Заметка не найдена в пространстве подборки');
      return { kind, ref: n.ref, refEnd: null, annotationId: n.id, body: optional(b.body), heading: 0 };
    }
    if (kind === 'text') {
      return { kind, ref: null, refEnd: null, annotationId: null, body: text(b.body, 'Текст', MAX_BODY), heading: b.heading ? 1 : 0 };
    }
    throw new HttpError(400, 'kind: para, note или text');
  }

  // My collections in a workspace, plus those I subscribed to.
  router.on('GET', '/api/workspaces/:id/collections', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'viewer');
    return {
      own: /** @type {any[]} */ (q.byWorkspace.all(ws)).map(present),
      subscribed: /** @type {any[]} */ (q.subscribed.all(user.id)).filter((c) => c.workspaceId !== ws).map(present),
    };
  });

  // Every shared collection of the platform (to discover and subscribe).
  router.on('GET', '/api/collections/shared', () => /** @type {any[]} */ (q.sharedAll.all()).map(present));

  router.on('POST', '/api/workspaces/:id/collections', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'editor');
    const b = await body(req);
    const { id } = /** @type {{ id: number }} */ (q.insert.get(ws, text(b.title, 'Название', MAX_TITLE), optional(b.description), user.id, null));
    return present(q.meta.get(id));
  });

  router.on('GET', '/api/collections/:cid', ({ params, user }) => {
    const { c, role, canEdit } = load(Number(params.cid), user);
    return {
      ...present(c),
      member: !!role,
      canEdit,
      subscribed: !!q.isSubscribed.get(user.id, c.id),
      list: items(c.id),
    };
  });

  // { title?, description?, shared? }
  router.on('PATCH', '/api/collections/:cid', async ({ req, params, user }) => {
    const c = editable(Number(params.cid), user);
    const b = await body(req);
    q.update.run(
      b.title === undefined ? c.title : text(b.title, 'Название', MAX_TITLE),
      b.description === undefined ? c.description : optional(b.description),
      b.shared === undefined ? c.shared : b.shared ? 1 : 0,
      c.id,
    );
    return present(q.meta.get(c.id));
  });

  router.on('DELETE', '/api/collections/:cid', ({ params, user }) => {
    const c = editable(Number(params.cid), user);
    q.remove.run(c.id);
    return { id: c.id, deleted: true };
  });

  // { kind, ref?, refEnd?, annotationId?, body?, heading?, after? } — appended, or put after item `after`.
  router.on('POST', '/api/collections/:cid/items', async ({ req, params, user }) => {
    const c = editable(Number(params.cid), user);
    const b = await body(req);
    const f = itemFields(b, c.workspaceId);
    const id = transaction(db, () => {
      let pos = /** @type {{ pos: number }} */ (q.maxPos.get(c.id)).pos + 1;
      if (b.after !== undefined && b.after !== null) {
        const at = /** @type {{ pos: number } | undefined} */ (q.posOf.get(Number(b.after), c.id));
        if (at) {
          q.shiftFrom.run(c.id, at.pos);
          pos = at.pos + 1;
        }
      }
      const row = /** @type {{ id: number }} */ (q.addItem.get(c.id, pos, f.kind, f.ref, f.refEnd, f.annotationId, f.body, f.heading));
      q.touch.run(c.id);
      return row.id;
    });
    return { id };
  });

  // { body?, heading? }
  router.on('PATCH', '/api/collections/:cid/items/:iid', async ({ req, params, user }) => {
    const c = editable(Number(params.cid), user);
    const iid = Number(params.iid);
    const it = /** @type {any} */ (q.items.all(c.id)).find((/** @type {any} */ x) => x.id === iid);
    if (!it) throw new HttpError(404, 'Элемент не найден');
    const b = await body(req);
    const newBody = b.body === undefined ? it.body : it.kind === 'text' ? text(b.body, 'Текст', MAX_BODY) : optional(b.body);
    q.editItem.run(newBody, it.kind === 'text' && b.heading !== undefined ? (b.heading ? 1 : 0) : it.heading, iid);
    q.touch.run(c.id);
    return { ok: true };
  });

  router.on('DELETE', '/api/collections/:cid/items/:iid', ({ params, user }) => {
    const c = editable(Number(params.cid), user);
    if (!q.item.get(Number(params.iid), c.id)) throw new HttpError(404, 'Элемент не найден');
    q.removeItem.run(Number(params.iid));
    q.touch.run(c.id);
    return { ok: true };
  });

  // New order: { ids: number[] } — every item of the collection, in the wanted order.
  router.on('PUT', '/api/collections/:cid/order', async ({ req, params, user }) => {
    const c = editable(Number(params.cid), user);
    const ids = (await body(req)).ids;
    const current = /** @type {any[]} */ (q.items.all(c.id)).map((x) => x.id);
    if (!Array.isArray(ids) || ids.length !== current.length || !current.every((id) => ids.includes(id))) {
      throw new HttpError(400, 'ids: все элементы подборки в новом порядке');
    }
    transaction(db, () => {
      ids.forEach((id, i) => q.setPos.run(i + 1, id, c.id));
      q.touch.run(c.id);
    });
    return { ok: true };
  });

  // { subscribed: boolean } — for shared collections of other workspaces.
  router.on('POST', '/api/collections/:cid/subscribe', async ({ req, params, user }) => {
    const { c } = load(Number(params.cid), user);
    if ((await body(req)).subscribed === false) q.unsubscribe.run(user.id, c.id);
    else {
      if (!c.shared) throw new HttpError(400, 'Подписаться можно на общую подборку');
      q.subscribe.run(user.id, c.id);
    }
    return { subscribed: !!q.isSubscribed.get(user.id, c.id) };
  });

  // { workspaceId } — an editable copy. Notes of another workspace become paragraph items whose
  // comment keeps the note's quote and comments (the notes themselves stay where they are).
  router.on('POST', '/api/collections/:cid/copy', async ({ req, params, user }) => {
    const { c } = load(Number(params.cid), user);
    const ws = Number((await body(req)).workspaceId);
    auth.require(ws, user, 'editor');
    const source = items(c.id);
    const id = transaction(db, () => {
      const row = /** @type {{ id: number }} */ (q.insert.get(ws, c.title, c.description, user.id, c.id));
      source.forEach((it, i) => {
        if (it.kind === 'note' && c.workspaceId !== ws) {
          const n = it.note;
          const parts = [it.body, n?.quote ? `«${n.quote}»` : null, ...(n?.comments ?? []).map((/** @type {any} */ m) => `${m.authorName ?? ''}: ${m.body}`)];
          q.addItem.get(row.id, i + 1, 'para', it.ref, null, null, parts.filter(Boolean).join('\n\n') || null, 0);
        } else {
          q.addItem.get(row.id, i + 1, it.kind, it.ref, it.refEnd, it.annotationId, it.body, it.heading ? 1 : 0);
        }
      });
      return row.id;
    });
    return present(q.meta.get(id));
  });
}
