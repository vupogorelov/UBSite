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
 * @param {ReturnType<typeof import('../chat.js').createChat>} chat
 */
export function registerCollectionRoutes(router, db, auth, chat) {
  const META = `
    SELECT c.id, c.workspace_id AS workspaceId, c.title, c.description, c.shared, c.fragments_only AS fragmentsOnly, c.author_id AS authorId,
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
    update: db.prepare(
      "UPDATE collections SET title = ?, description = ?, shared = ?, fragments_only = ?, updated_at = datetime('now') WHERE id = ?",
    ),
    touch: db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM collections WHERE id = ?'),
    items: db.prepare(`
      SELECT id, kind, ref, ref_end AS refEnd, annotation_id AS annotationId, body, heading, collapsed,
             frag_lang AS fragLang, frag_start AS fragStart, frag_end AS fragEnd, quote,
             msg_id AS msgId, msg_author AS msgAuthor, msg_at AS msgAt, msg_chat AS msgChat
      FROM collection_items WHERE collection_id = ? ORDER BY pos, id`),
    item: db.prepare('SELECT id FROM collection_items WHERE id = ? AND collection_id = ?'),
    maxPos: db.prepare('SELECT coalesce(max(pos), 0) AS pos FROM collection_items WHERE collection_id = ?'),
    shiftFrom: db.prepare('UPDATE collection_items SET pos = pos + 1 WHERE collection_id = ? AND pos > ?'),
    posOf: db.prepare('SELECT pos FROM collection_items WHERE id = ? AND collection_id = ?'),
    addItem: db.prepare(
      `INSERT INTO collection_items (collection_id, pos, kind, ref, ref_end, annotation_id, body, heading, frag_lang, frag_start, frag_end,
                                     quote, collapsed, msg_id, msg_author, msg_at, msg_chat)
       VALUES (:collection, :pos, :kind, :ref, :refEnd, :annotationId, :body, :heading, :fragLang, :fragStart, :fragEnd,
               :quote, :collapsed, :msgId, :msgAuthor, :msgAt, :msgChat) RETURNING id`,
    ),
    message: db.prepare(`
      SELECT m.id, m.ref AS chat, m.kind, m.body, m.created_at AS createdAt, m.hidden_at AS hiddenAt,
             coalesce(u.display_name, u.username) AS authorName
      FROM public_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`),
    noteRef: db.prepare('SELECT ref FROM annotations WHERE id = ?'),
    editItem: db.prepare('UPDATE collection_items SET body = ?, heading = ?, collapsed = ? WHERE id = ?'),
    plain: db.prepare('SELECT plain_ru, plain_en FROM paragraphs WHERE ref = ?'),
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
      SELECT m.id, m.body, m.created_at AS createdAt, coalesce(u.display_name, u.username) AS authorName
      FROM public_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ref = ? AND m.kind = 'message' AND m.hidden_at IS NULL ORDER BY m.id`),
    noteTags: db.prepare('SELECT t.name FROM annotation_tags at JOIN tags t ON t.id = at.tag_id WHERE at.annotation_id = ? ORDER BY t.name'),
    isSubscribed: db.prepare('SELECT 1 AS yes FROM collection_subscriptions WHERE user_id = ? AND collection_id = ?'),
    subscribe: db.prepare('INSERT OR IGNORE INTO collection_subscriptions (user_id, collection_id) VALUES (?, ?)'),
    unsubscribe: db.prepare('DELETE FROM collection_subscriptions WHERE user_id = ? AND collection_id = ?'),
  };

  // Before fragments existed, "В подборку" on a selection put the selected words into the item's
  // comment as «…». Such quotes found in the paragraph become its fragment (the rest stays the comment).
  for (const it of /** @type {{ id: number, ref: string, body: string }[]} */ (
    db.prepare("SELECT id, ref, body FROM collection_items WHERE kind = 'para' AND ref_end IS NULL AND frag_lang IS NULL AND body LIKE '«%'").all()
  )) {
    const m = it.body.endsWith('»') ? [it.body, it.body.slice(1, -1), ''] : it.body.match(/^«([\s\S]+?)»\s*\n([\s\S]*)$/);
    const p = /** @type {{ plain_ru: string, plain_en: string } | undefined} */ (q.plain.get(it.ref));
    if (!m || !p) continue;
    const quote = m[1];
    const [lang, start] = p.plain_ru.includes(quote) ? ['ru', p.plain_ru.indexOf(quote)] : ['en', p.plain_en.indexOf(quote)];
    if (start < 0) continue;
    db.prepare('UPDATE collection_items SET frag_lang = ?, frag_start = ?, frag_end = ?, quote = ?, body = ? WHERE id = ?')
      .run(lang, start, start + quote.length, quote, m[2].trim() || null, it.id);
  }

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
  const present = (c) => ({ ...c, shared: !!c.shared, fragmentsOnly: !!c.fragmentsOnly });

  /**
   * Items with their content: paragraphs (HTML), notes with comments and tags. `fragment` is the
   * part of the paragraph the item points at — its own one, or its note's.
   * @param {number} id
   */
  function items(id) {
    return /** @type {any[]} */ (q.items.all(id)).map(({ fragLang, fragStart, fragEnd, quote, msgId, msgAuthor, msgAt, msgChat, ...it }) => {
      /** @type {Record<string, any>} */
      const out = { ...it, heading: !!it.heading, collapsed: !!it.collapsed, fragment: null };
      // a message: as it was said (a snapshot), where it was said, and its place in the book
      if (it.kind === 'message') out.message = { id: msgId, authorName: msgAuthor, createdAt: msgAt, chat: msgChat, text: quote };
      if (it.kind === 'para') {
        out.paragraphs = q.range.all(it.ref, it.refEnd ?? it.ref);
        if (fragLang) out.fragment = { lang: fragLang, start: fragStart, end: fragEnd, quote };
      }
      if (it.kind === 'note') {
        const n = /** @type {any} */ (q.note.get(it.annotationId));
        out.note = n && {
          ...n,
          bookmark: !!n.bookmark,
          comments: q.noteComments.all(`note:${n.id}`),
          tags: /** @type {{ name: string }[]} */ (q.noteTags.all(n.id)).map((t) => t.name),
        };
        out.paragraphs = n ? q.range.all(n.ref, n.ref) : [];
        if (n?.lang) out.fragment = { lang: n.lang, start: n.start, end: n.end, quote: n.quote };
      }
      return out;
    });
  }

  /**
   * A fragment of one paragraph: offsets in its plain text, the quote taken from the text itself.
   * @param {string} ref @param {unknown} f
   */
  function fragmentOf(ref, f) {
    const v = /** @type {Record<string, unknown>} */ (f);
    if (v.lang !== 'ru' && v.lang !== 'en') throw new HttpError(400, 'fragment.lang: ru или en');
    const p = /** @type {{ plain_ru: string, plain_en: string }} */ (q.plain.get(ref));
    const text = v.lang === 'ru' ? p.plain_ru : p.plain_en;
    const start = Number(v.start);
    const end = Number(v.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
      throw new HttpError(400, 'Неверные границы фрагмента');
    }
    return { lang: v.lang, start, end, quote: text.slice(start, end) };
  }

  /**
   * A message of a conversation the user can read, as a collection item: a snapshot of what was said
   * and its place in the book — the paragraph of a thread, the note's paragraph, or else the first
   * existing paragraph the message refers to (5:1.2).
   * @param {unknown} messageId @param {import('../auth.js').User} user
   */
  function messageFields(messageId, user) {
    const m = /** @type {any} */ (q.message.get(Number(messageId)));
    if (!m || m.kind !== 'message' || m.hiddenAt) throw new HttpError(400, 'Сообщение не найдено');
    chat.access(m.chat, user, false); // only what the user may read
    let ref = /^\d+:\d+\.\d+$/.test(m.chat) ? m.chat : null;
    if (m.chat.startsWith('note:')) ref = /** @type {{ ref: string } | undefined} */ (q.noteRef.get(Number(m.chat.slice(5))))?.ref ?? null;
    if (!ref) {
      for (const [r] of m.body.matchAll(/\b\d{1,3}:\d{1,2}\.\d{1,3}\b/g)) {
        if (q.para.get(r)) {
          ref = r;
          break;
        }
      }
    }
    return { ref, message: { id: m.id, author: m.authorName, at: m.createdAt, chat: m.chat, text: m.body } };
  }

  /**
   * @typedef {{ kind: string, ref: string | null, refEnd: string | null, annotationId: number | null, body: string | null,
   *   heading: number, fragment?: { lang: string, start: number, end: number, quote: string } | null,
   *   message?: { id: number | null, author: string | null, at: string | null, chat: string | null, text: string } | null,
   *   collapsed?: boolean }} ItemFields
   * @param {number} collection @param {number} pos @param {ItemFields} f @returns {number}
   */
  function insertItem(collection, pos, f) {
    const fr = f.fragment ?? null;
    const m = f.message ?? null;
    return /** @type {{ id: number }} */ (q.addItem.get({
      collection, pos, kind: f.kind, ref: f.ref, refEnd: f.refEnd, annotationId: f.annotationId, body: f.body, heading: f.heading,
      fragLang: fr?.lang ?? null, fragStart: fr?.start ?? null, fragEnd: fr?.end ?? null, quote: fr?.quote ?? m?.text ?? null,
      collapsed: f.collapsed ? 1 : 0, msgId: m?.id ?? null, msgAuthor: m?.author ?? null, msgAt: m?.at ?? null, msgChat: m?.chat ?? null,
    })).id;
  }

  /**
   * Validated item fields from a request body.
   * @param {Record<string, unknown>} b @param {number} ws @param {import('../auth.js').User} user
   */
  function itemFields(b, ws, user) {
    const kind = b.kind;
    if (kind === 'message') {
      const { ref, message } = messageFields(b.messageId, user);
      return { kind, ref, refEnd: null, annotationId: null, body: optional(b.body), heading: 0, fragment: null, message };
    }
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
      const hasFragment = b.fragment !== undefined && b.fragment !== null;
      if (hasFragment && refEnd) throw new HttpError(400, 'Фрагмент — только у одного абзаца');
      const fragment = hasFragment ? fragmentOf(first.ref, b.fragment) : null;
      return { kind, ref: first.ref, refEnd, annotationId: null, body: optional(b.body), heading: 0, fragment };
    }
    if (kind === 'note') {
      const n = /** @type {any} */ (q.noteInWs.get(Number(b.annotationId), ws));
      if (!n) throw new HttpError(400, 'Заметка не найдена в пространстве подборки');
      return { kind, ref: n.ref, refEnd: null, annotationId: n.id, body: optional(b.body), heading: 0, fragment: null };
    }
    if (kind === 'text') {
      return {
        kind, ref: null, refEnd: null, annotationId: null, body: text(b.body, 'Текст', MAX_BODY), heading: b.heading ? 1 : 0, fragment: null,
      };
    }
    throw new HttpError(400, 'kind: para, note, text или message');
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

  // { title?, description?, shared?, fragmentsOnly? }
  router.on('PATCH', '/api/collections/:cid', async ({ req, params, user }) => {
    const c = editable(Number(params.cid), user);
    const b = await body(req);
    q.update.run(
      b.title === undefined ? c.title : text(b.title, 'Название', MAX_TITLE),
      b.description === undefined ? c.description : optional(b.description),
      b.shared === undefined ? c.shared : b.shared ? 1 : 0,
      b.fragmentsOnly === undefined ? c.fragmentsOnly : b.fragmentsOnly ? 1 : 0,
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
    const f = itemFields(b, c.workspaceId, user);
    const id = transaction(db, () => {
      let pos = /** @type {{ pos: number }} */ (q.maxPos.get(c.id)).pos + 1;
      if (b.after !== undefined && b.after !== null) {
        const at = /** @type {{ pos: number } | undefined} */ (q.posOf.get(Number(b.after), c.id));
        if (at) {
          q.shiftFrom.run(c.id, at.pos);
          pos = at.pos + 1;
        }
      }
      const rowId = insertItem(c.id, pos, f);
      q.touch.run(c.id);
      return rowId;
    });
    return { id };
  });

  // { body?, heading?, collapsed? }
  router.on('PATCH', '/api/collections/:cid/items/:iid', async ({ req, params, user }) => {
    const c = editable(Number(params.cid), user);
    const iid = Number(params.iid);
    const it = /** @type {any} */ (q.items.all(c.id)).find((/** @type {any} */ x) => x.id === iid);
    if (!it) throw new HttpError(404, 'Элемент не найден');
    const b = await body(req);
    const newBody = b.body === undefined ? it.body : it.kind === 'text' ? text(b.body, 'Текст', MAX_BODY) : optional(b.body);
    const collapsed = it.kind !== 'text' && typeof b.collapsed === 'boolean' ? (b.collapsed ? 1 : 0) : it.collapsed;
    q.editItem.run(newBody, it.kind === 'text' && b.heading !== undefined ? (b.heading ? 1 : 0) : it.heading, collapsed, iid);
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

  // { workspaceId } — an editable copy. Notes of another workspace become paragraph items with the
  // note's fragment, the comments going into the explanation (the notes themselves stay where they are).
  router.on('POST', '/api/collections/:cid/copy', async ({ req, params, user }) => {
    const { c } = load(Number(params.cid), user);
    const ws = Number((await body(req)).workspaceId);
    auth.require(ws, user, 'editor');
    const source = items(c.id);
    const id = transaction(db, () => {
      const row = /** @type {{ id: number }} */ (q.insert.get(ws, c.title, c.description, user.id, c.id));
      if (c.fragmentsOnly) q.update.run(c.title, c.description, 0, 1, row.id);
      source.forEach((it, i) => {
        const message = it.message
          ? { id: it.message.id, author: it.message.authorName, at: it.message.createdAt, chat: it.message.chat, text: it.message.text }
          : null;
        if (it.kind === 'note' && c.workspaceId !== ws) {
          const parts = [it.body, ...(it.note?.comments ?? []).map((/** @type {any} */ m) => `${m.authorName ?? ''}: ${m.body}`)];
          insertItem(row.id, i + 1, {
            kind: 'para', ref: it.ref, refEnd: null, annotationId: null, body: parts.filter(Boolean).join('\n\n') || null, heading: 0,
            fragment: it.fragment, collapsed: it.collapsed,
          });
        } else {
          insertItem(row.id, i + 1, {
            kind: it.kind, ref: it.ref, refEnd: it.refEnd, annotationId: it.annotationId, body: it.body, heading: it.heading ? 1 : 0,
            fragment: it.kind === 'note' ? null : it.fragment, // the note keeps its own fragment
            message, collapsed: it.collapsed,
          });
        }
      });
      return row.id;
    });
    return present(q.meta.get(id));
  });
}
