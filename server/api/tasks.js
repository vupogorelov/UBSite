// @ts-check
// Personal tasks: each user's own (across all workspaces), sorted by tags (#words in the title and the
// tags added in the details — shared/tasktags.js), with subtasks, and optionally tied to a place in the
// book — a paragraph or range, a note, a collection.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import { normTag } from '../../shared/tasktags.js';
import { STATUS_MARK } from '../marktasks.js';

const MAX_TITLE = 500;
const MAX_NOTES = 20_000;
const STATUSES = new Set(['todo', 'doing', 'done']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 * @param {ReturnType<typeof import('../chat.js').createChat>} chat
 */
export function registerTaskRoutes(router, db, auth, chat) {
  // `messageChat` / `messageChatTitle`: a task made from a message keeps the way back to it.
  const TASK = `
    SELECT t.id, t.uid, t.title, t.notes, t.status, t.important, t.due, t.tags, t.ref, t.ref_end AS refEnd,
           t.annotation_id AS annotationId, t.collection_id AS collectionId, c.title AS collectionTitle,
           pp.title_ru AS paperTitle, t.pos, t.done_at AS doneAt, t.created_at AS createdAt, t.updated_at AS updatedAt,
           t.message_id AS messageId, t.message_chat AS messageChat,
           CASE WHEN t.message_chat LIKE 'chan:%' THEN (SELECT title FROM channels WHERE id = CAST(substr(t.message_chat, 6) AS INTEGER))
                WHEN t.message_chat LIKE 'ws:%' THEN (SELECT name FROM workspaces WHERE id = CAST(substr(t.message_chat, 4) AS INTEGER))
                WHEN t.message_chat LIKE 'note:%' THEN 'заметка'
                WHEN t.message_chat LIKE 'dict:%' THEN (SELECT 'словарь · ' || name_ru FROM dict_articles WHERE id = CAST(substr(t.message_chat, 6) AS INTEGER))
                WHEN t.message_chat IS NOT NULL THEN 'абзац ' || t.message_chat END AS messageChatTitle
    FROM tasks t
    LEFT JOIN collections c ON c.id = t.collection_id
    LEFT JOIN paragraphs pa ON pa.ref = t.ref
    LEFT JOIN papers pp ON pp.id = pa.paper_id`;
  const q = {
    tasks: db.prepare(`${TASK} WHERE t.user_id = ? ORDER BY t.pos, t.id`),
    task: db.prepare(`${TASK} WHERE t.id = ? AND t.user_id = ?`),
    raw: db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?'),
    insert: db.prepare(`
      INSERT INTO tasks (user_id, title, notes, status, important, due, tags, ref, ref_end, annotation_id, collection_id,
                         message_id, message_chat, pos)
      VALUES (:user, :title, :notes, 'todo', :important, :due, :tags, :ref, :refEnd, :annotationId, :collectionId,
              :messageId, :messageChat, (SELECT coalesce(min(pos), 0) - 1 FROM tasks WHERE user_id = :user))
      RETURNING id`),
    update: db.prepare(`
      UPDATE tasks SET title = :title, notes = :notes, status = :status, important = :important, due = :due,
             tags = :tags, ref = :ref, ref_end = :refEnd, annotation_id = :annotationId, collection_id = :collectionId,
             done_at = :doneAt, updated_at = datetime('now')
      WHERE id = :id`),
    remove: db.prepare('DELETE FROM tasks WHERE id = ?'),
    setPos: db.prepare('UPDATE tasks SET pos = ? WHERE id = ? AND user_id = ?'),
    subtasks: db.prepare('SELECT s.id, s.task_id AS taskId, s.title, s.done FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE t.user_id = ? ORDER BY s.pos, s.id'),
    subtasksOf: db.prepare('SELECT id, task_id AS taskId, title, done FROM subtasks WHERE task_id = ? ORDER BY pos, id'),
    subtask: db.prepare('SELECT s.* FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ? AND s.task_id = ? AND t.user_id = ?'),
    addSubtask: db.prepare('INSERT INTO subtasks (task_id, title, pos) VALUES (?, ?, (SELECT coalesce(max(pos), 0) + 1 FROM subtasks WHERE task_id = ?)) RETURNING id'),
    editSubtask: db.prepare('UPDATE subtasks SET title = ?, done = ? WHERE id = ?'),
    removeSubtask: db.prepare('DELETE FROM subtasks WHERE id = ?'),
    touch: db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?"),
    para: db.prepare('SELECT ref, seq FROM paragraphs WHERE ref = ?'),
    note: db.prepare('SELECT id, workspace_id AS ws, ref FROM annotations WHERE id = ?'),
    collection: db.prepare('SELECT id, workspace_id AS ws, shared FROM collections WHERE id = ?'),
    message: db.prepare('SELECT id, ref AS chat, kind, body FROM public_messages WHERE id = ?'),
    messageMark: db.prepare('SELECT mark FROM public_messages WHERE id = ?'),
    dueCount: db.prepare("SELECT count(*) AS n FROM tasks WHERE user_id = ? AND status != 'done' AND due IS NOT NULL AND due <= ?"),
    byUid: db.prepare('SELECT id FROM tasks WHERE user_id = ? AND uid = ?'),
    setUid: db.prepare('UPDATE tasks SET uid = ? WHERE id = ?'),
    addSubtaskDone: db.prepare('UPDATE subtasks SET done = 1 WHERE id = ?'),
    // the feed of changes (migrations 34–35)
    feedTop: db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'"),
    feedMin: db.prepare('SELECT min(seq) AS seq FROM changes'),
    feedTasks: db.prepare("SELECT DISTINCT entity_id AS id FROM changes WHERE user_id = ? AND entity = 'task' AND seq > ? AND seq <= ?"),
  };
  /**
   * The task in the URL: its number, or "u-<uid>" — the id its device gave it (a task made without a
   * network is addressed so before the device learns its number).
   * @param {string | number} aid @param {number} user
   */
  const taskId = (aid, user) => {
    const m = String(aid).match(/^u-([\w-]{8,64})$/);
    if (!m) return Number(aid);
    const row = /** @type {{ id: number } | undefined} */ (q.byUid.get(user, m[1]));
    if (!row) throw new HttpError(404, 'Задача не найдена');
    return row.id;
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
  const optional = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_NOTES) : null);
  /** @param {unknown} v */
  const due = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string' || !DATE.test(v)) throw new HttpError(400, 'Срок: дата ГГГГ-ММ-ДД');
    return v;
  };
  /** The tags added in the details (the title's #tags are read from the title itself). @param {unknown} v */
  const tags = (v) => {
    if (v === undefined || v === null) return '[]';
    if (!Array.isArray(v)) throw new HttpError(400, 'tags: массив меток');
    const list = [...new Set(v.map((x) => (typeof x === 'string' ? normTag(x) : null)).filter(Boolean))];
    return JSON.stringify(list.slice(0, 20));
  };

  /** @param {any} t @param {Map<number, any[]>} subs */
  const present = (t, subs) => ({
    ...t,
    important: !!t.important,
    tags: JSON.parse(t.tags),
    subtasks: (subs.get(t.id) ?? []).map(({ taskId, done, ...s }) => ({ ...s, done: !!done })),
  });
  /** @param {number} id @param {number} user */
  const fetchOne = (id, user) => {
    const t = q.task.get(id, user);
    if (!t) throw new HttpError(404, 'Задача не найдена');
    return present(t, new Map([[id, /** @type {any[]} */ (q.subtasksOf.all(id))]]));
  };
  /** @param {number} id @param {number} user */
  const own = (id, user) => {
    const t = /** @type {any} */ (q.raw.get(id, user));
    if (!t) throw new HttpError(404, 'Задача не найдена');
    return t;
  };

  /**
   * Checked links of a task to the book; each one is optional.
   * @param {Record<string, unknown>} b @param {any} cur @param {import('../auth.js').User} user
   */
  function links(b, cur, user) {
    let ref = 'ref' in b ? b.ref ?? null : cur.ref;
    let refEnd = 'refEnd' in b ? b.refEnd ?? null : cur.ref_end;
    let annotationId = 'annotationId' in b ? b.annotationId ?? null : cur.annotation_id;
    const collectionId = 'collectionId' in b ? b.collectionId ?? null : cur.collection_id;
    if ('annotationId' in b && annotationId !== null) {
      const n = /** @type {any} */ (q.note.get(Number(annotationId)));
      if (!n || !auth.role(n.ws, user.id)) throw new HttpError(400, 'Заметка не найдена');
      annotationId = n.id;
      if (!('ref' in b)) ((ref = n.ref), (refEnd = null));
    }
    if (ref !== null) {
      const first = /** @type {any} */ (q.para.get(String(ref)));
      if (!first) throw new HttpError(400, `Абзац ${ref} не найден`);
      ref = first.ref;
      if (refEnd !== null && refEnd !== ref) {
        const last = /** @type {any} */ (q.para.get(String(refEnd)));
        if (!last || last.seq < first.seq) throw new HttpError(400, 'Неверный конец диапазона');
        refEnd = last.ref;
      } else refEnd = null;
    } else refEnd = null;
    if ('collectionId' in b && collectionId !== null) {
      const c = /** @type {any} */ (q.collection.get(Number(collectionId)));
      if (!c || (!c.shared && !auth.role(c.ws, user.id))) throw new HttpError(400, 'Подборка не найдена');
    }
    return { ref, refEnd, annotationId, collectionId: collectionId === null ? null : Number(collectionId) };
  }

  router.on('GET', '/api/tasks', ({ user }) => {
    const subs = Map.groupBy(/** @type {any[]} */ (q.subtasks.all(user.id)), (s) => s.taskId);
    return { tasks: /** @type {any[]} */ (q.tasks.all(user.id)).map((t) => present(t, subs)) };
  });

  // The feed: what changed in the person's tasks after `since` — { seq, reset, tasks, deleted }; no `since`
  // (the first time), too far behind or ahead: every task anew. The device keeps them (web/src/lib/feed.js).
  router.on('GET', '/api/tasks/changes', ({ url, user }) => {
    const given = url.searchParams.get('since');
    const since = Math.max(0, Number(given) || 0);
    const seq = /** @type {{ seq: number } | undefined} */ (q.feedTop.get())?.seq ?? 0;
    const oldest = /** @type {{ seq: number | null }} */ (q.feedMin.get()).seq ?? seq + 1;
    if (given === null || since < oldest - 1 || since > seq) {
      const subs = Map.groupBy(/** @type {any[]} */ (q.subtasks.all(user.id)), (s) => s.taskId);
      return { seq, reset: true, tasks: /** @type {any[]} */ (q.tasks.all(user.id)).map((t) => present(t, subs)), deleted: [] };
    }
    /** @type {any[]} */ const changed = [];
    /** @type {number[]} */ const deleted = [];
    for (const { id } of /** @type {{ id: number }[]} */ (q.feedTasks.all(user.id, since, seq))) {
      if (q.task.get(id, user.id)) changed.push(fetchOne(id, user.id));
      else deleted.push(id);
    }
    return { seq, reset: false, tasks: changed, deleted };
  });

  // Tasks due today or overdue — for the counter in the top bar. ?today=YYYY-MM-DD (the user's day).
  router.on('GET', '/api/tasks/count', ({ url, user }) => {
    const today = url.searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
    if (!DATE.test(today)) throw new HttpError(400, 'today: дата ГГГГ-ММ-ДД');
    return { due: /** @type {{ n: number }} */ (q.dueCount.get(user.id, today)).n };
  });

  /**
   * "В задачи" from a message the user can read: the way back to it, and its place in the book unless
   * one is given — the paragraph of a thread, the note of a note's comment, else the first existing
   * paragraph it refers to (5:1.2).
   * @param {Record<string, unknown>} b @param {import('../auth.js').User} user
   */
  function fromMessage(b, user) {
    if (b.messageId === undefined || b.messageId === null) return { messageId: null, messageChat: null };
    const m = /** @type {any} */ (q.message.get(Number(b.messageId)));
    if (!m || m.kind !== 'message') throw new HttpError(400, 'Сообщение не найдено');
    chat.access(m.chat, user, false); // only what the user may read
    if (!('ref' in b) && !('annotationId' in b)) {
      if (/^\d+:\d+\.\d+$/.test(m.chat)) b.ref = m.chat;
      else if (m.chat.startsWith('note:')) b.annotationId = Number(m.chat.slice(5));
      else {
        const r = [...m.body.matchAll(/\b\d{1,3}:\d{1,2}\.\d{1,3}\b/g)].map((x) => x[0]).find((x) => q.para.get(x));
        if (r) b.ref = r;
      }
    }
    return { messageId: m.id, messageChat: m.chat };
  }

  // { title, notes?, due?, important?, tags?, ref?, refEnd?, annotationId?, collectionId?, messageId?, uid? }
  // `uid`: the task's id from the device that made it; the same uid again is the same task.
  router.on('POST', '/api/tasks', async ({ req, user }) => {
    const b = await body(req);
    const uid = b.uid === undefined || b.uid === null ? null : String(b.uid);
    if (uid !== null && !/^[\w-]{8,64}$/.test(uid)) throw new HttpError(400, 'uid: 8–64 букв, цифр, «-», «_»');
    const known = uid === null ? undefined : /** @type {{ id: number } | undefined} */ (q.byUid.get(user.id, uid));
    if (known) return fetchOne(known.id, user.id);
    const msg = fromMessage(b, user);
    const l = links(b, { ref: null, ref_end: null, annotation_id: null, collection_id: null }, user);
    const id = transaction(db, () => {
      const row = /** @type {{ id: number }} */ (
        q.insert.get({
          user: user.id, title: text(b.title, 'Задача', MAX_TITLE), notes: optional(b.notes),
          important: b.important ? 1 : 0, due: due(b.due), tags: tags(b.tags), ...l, ...msg,
        })
      );
      if (uid !== null) q.setUid.run(uid, row.id);
      return row.id;
    });
    return fetchOne(id, user.id);
  });

  // Any of { title, notes, status, important, due, tags, ref, refEnd, annotationId, collectionId }
  router.on('PATCH', '/api/tasks/:id', async ({ req, params, user }) => {
    const cur = own(taskId(params.id, user.id), user.id);
    const b = await body(req);
    const status = b.status === undefined ? cur.status : String(b.status);
    if (!STATUSES.has(status)) throw new HttpError(400, 'status: todo, doing или done');
    q.update.run({
      id: cur.id,
      title: b.title === undefined ? cur.title : text(b.title, 'Задача', MAX_TITLE),
      notes: b.notes === undefined ? cur.notes : optional(b.notes),
      status,
      important: b.important === undefined ? cur.important : b.important ? 1 : 0,
      due: 'due' in b ? due(b.due) : cur.due,
      tags: b.tags === undefined ? cur.tags : tags(b.tags),
      ...links(b, cur, user),
      doneAt: status === 'done' ? cur.done_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    });
    // a task of a marked message (server/marktasks.js) moved between statuses: the mark moves too
    if (status !== cur.status && cur.message_id && user.isAdmin) {
      const m = /** @type {{ mark: string | null } | undefined} */ (q.messageMark.get(cur.message_id));
      if (m?.mark && m.mark !== STATUS_MARK[status]) {
        try {
          chat.mark(cur.message_id, user, STATUS_MARK[status]);
        } catch {} // the message is gone or out of reach: the task stays as it is
      }
    }
    return fetchOne(cur.id, user.id);
  });

  router.on('DELETE', '/api/tasks/:id', ({ params, user }) => {
    q.remove.run(own(taskId(params.id, user.id), user.id).id);
    return { ok: true };
  });

  // Manual order: { ids } — the moved tasks in their new order (others keep theirs); a task not numbered
  // by the server yet as "u-<uid>".
  router.on('PUT', '/api/tasks/order', async ({ req, user }) => {
    const ids = (await body(req)).ids;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x) || /^u-[\w-]{8,64}$/.test(String(x)))) throw new HttpError(400, 'ids: номера задач');
    transaction(db, () => ids.forEach((id, i) => q.setPos.run(i, taskId(id, user.id), user.id)));
    return { ok: true };
  });

  // { title, done? } — done: ticked already before it reached the server (written without a network)
  router.on('POST', '/api/tasks/:id/subtasks', async ({ req, params, user }) => {
    const t = own(taskId(params.id, user.id), user.id);
    const b = await body(req);
    transaction(db, () => {
      const { id } = /** @type {{ id: number }} */ (q.addSubtask.get(t.id, text(b.title, 'Подзадача', MAX_TITLE), t.id));
      if (b.done === true) q.addSubtaskDone.run(id);
      q.touch.run(t.id);
    });
    return fetchOne(t.id, user.id);
  });

  // { title?, done? }
  router.on('PATCH', '/api/tasks/:id/subtasks/:sid', async ({ req, params, user }) => {
    const s = /** @type {any} */ (q.subtask.get(Number(params.sid), taskId(params.id, user.id), user.id));
    if (!s) throw new HttpError(404, 'Подзадача не найдена');
    const b = await body(req);
    q.editSubtask.run(b.title === undefined ? s.title : text(b.title, 'Подзадача', MAX_TITLE), b.done === undefined ? s.done : b.done ? 1 : 0, s.id);
    q.touch.run(s.task_id);
    return fetchOne(s.task_id, user.id);
  });

  router.on('DELETE', '/api/tasks/:id/subtasks/:sid', ({ params, user }) => {
    const s = /** @type {any} */ (q.subtask.get(Number(params.sid), taskId(params.id, user.id), user.id));
    if (!s) throw new HttpError(404, 'Подзадача не найдена');
    q.removeSubtask.run(s.id);
    return fetchOne(s.task_id, user.id);
  });
}
