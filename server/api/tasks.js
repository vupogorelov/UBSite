// @ts-check
// Personal tasks: each user's own (across all workspaces), in lists, with subtasks, and optionally
// tied to a place in the book — a paragraph or range, a note, a collection.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';

const MAX_TITLE = 500;
const MAX_NOTES = 20_000;
const STATUSES = new Set(['todo', 'doing', 'done']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 */
export function registerTaskRoutes(router, db, auth) {
  const TASK = `
    SELECT t.id, t.list_id AS listId, t.title, t.notes, t.status, t.important, t.due, t.tags, t.ref, t.ref_end AS refEnd,
           t.annotation_id AS annotationId, t.collection_id AS collectionId, c.title AS collectionTitle,
           pp.title_ru AS paperTitle, t.pos, t.done_at AS doneAt, t.created_at AS createdAt, t.updated_at AS updatedAt
    FROM tasks t
    LEFT JOIN collections c ON c.id = t.collection_id
    LEFT JOIN paragraphs pa ON pa.ref = t.ref
    LEFT JOIN papers pp ON pp.id = pa.paper_id`;
  const q = {
    lists: db.prepare('SELECT id, title, emoji, pos FROM task_lists WHERE user_id = ? ORDER BY pos, id'),
    list: db.prepare('SELECT id FROM task_lists WHERE id = ? AND user_id = ?'),
    addList: db.prepare('INSERT INTO task_lists (user_id, title, emoji, pos) VALUES (?, ?, ?, (SELECT coalesce(max(pos), 0) + 1 FROM task_lists WHERE user_id = ?)) RETURNING id'),
    editList: db.prepare('UPDATE task_lists SET title = ?, emoji = ? WHERE id = ?'),
    removeList: db.prepare('DELETE FROM task_lists WHERE id = ?'),
    tasks: db.prepare(`${TASK} WHERE t.user_id = ? ORDER BY t.pos, t.id`),
    task: db.prepare(`${TASK} WHERE t.id = ? AND t.user_id = ?`),
    raw: db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?'),
    insert: db.prepare(`
      INSERT INTO tasks (user_id, list_id, title, notes, status, important, due, tags, ref, ref_end, annotation_id, collection_id, pos)
      VALUES (:user, :listId, :title, :notes, 'todo', :important, :due, :tags, :ref, :refEnd, :annotationId, :collectionId,
              (SELECT coalesce(min(pos), 0) - 1 FROM tasks WHERE user_id = :user))
      RETURNING id`),
    update: db.prepare(`
      UPDATE tasks SET list_id = :listId, title = :title, notes = :notes, status = :status, important = :important, due = :due,
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
    dueCount: db.prepare("SELECT count(*) AS n FROM tasks WHERE user_id = ? AND status != 'done' AND due IS NOT NULL AND due <= ?"),
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
  /** @param {unknown} v */
  const tags = (v) => {
    if (v === undefined || v === null) return '[]';
    if (!Array.isArray(v)) throw new HttpError(400, 'tags: массив меток');
    const list = [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim().replace(/^#/, '').replace(/\s+/g, '_')).filter(Boolean))];
    return JSON.stringify(list.slice(0, 20).map((x) => x.slice(0, 60)));
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
  /** @param {unknown} v @param {number} user */
  const listId = (v, user) => {
    if (v === null || v === undefined) return null;
    if (!q.list.get(Number(v), user)) throw new HttpError(400, 'Список не найден');
    return Number(v);
  };

  router.on('GET', '/api/tasks', ({ user }) => {
    const subs = Map.groupBy(/** @type {any[]} */ (q.subtasks.all(user.id)), (s) => s.taskId);
    return { lists: q.lists.all(user.id), tasks: /** @type {any[]} */ (q.tasks.all(user.id)).map((t) => present(t, subs)) };
  });

  // Tasks due today or overdue — for the counter in the top bar. ?today=YYYY-MM-DD (the user's day).
  router.on('GET', '/api/tasks/count', ({ url, user }) => {
    const today = url.searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
    if (!DATE.test(today)) throw new HttpError(400, 'today: дата ГГГГ-ММ-ДД');
    return { due: /** @type {{ n: number }} */ (q.dueCount.get(user.id, today)).n };
  });

  router.on('POST', '/api/tasks', async ({ req, user }) => {
    const b = await body(req);
    const l = links(b, { ref: null, ref_end: null, annotation_id: null, collection_id: null }, user);
    const { id } = /** @type {{ id: number }} */ (
      q.insert.get({
        user: user.id, listId: listId(b.listId, user.id), title: text(b.title, 'Задача', MAX_TITLE), notes: optional(b.notes),
        important: b.important ? 1 : 0, due: due(b.due), tags: tags(b.tags), ...l,
      })
    );
    return fetchOne(id, user.id);
  });

  // Any of { title, notes, status, important, due, tags, listId, ref, refEnd, annotationId, collectionId }
  router.on('PATCH', '/api/tasks/:id', async ({ req, params, user }) => {
    const cur = own(Number(params.id), user.id);
    const b = await body(req);
    const status = b.status === undefined ? cur.status : String(b.status);
    if (!STATUSES.has(status)) throw new HttpError(400, 'status: todo, doing или done');
    q.update.run({
      id: cur.id,
      listId: 'listId' in b ? listId(b.listId, user.id) : cur.list_id,
      title: b.title === undefined ? cur.title : text(b.title, 'Задача', MAX_TITLE),
      notes: b.notes === undefined ? cur.notes : optional(b.notes),
      status,
      important: b.important === undefined ? cur.important : b.important ? 1 : 0,
      due: 'due' in b ? due(b.due) : cur.due,
      tags: b.tags === undefined ? cur.tags : tags(b.tags),
      ...links(b, cur, user),
      doneAt: status === 'done' ? cur.done_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    });
    return fetchOne(cur.id, user.id);
  });

  router.on('DELETE', '/api/tasks/:id', ({ params, user }) => {
    q.remove.run(own(Number(params.id), user.id).id);
    return { ok: true };
  });

  // Manual order: { ids } — the moved tasks in their new order (others keep theirs).
  router.on('PUT', '/api/tasks/order', async ({ req, user }) => {
    const ids = (await body(req)).ids;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) throw new HttpError(400, 'ids: номера задач');
    transaction(db, () => ids.forEach((id, i) => q.setPos.run(i, id, user.id)));
    return { ok: true };
  });

  router.on('POST', '/api/tasks/:id/subtasks', async ({ req, params, user }) => {
    const t = own(Number(params.id), user.id);
    q.addSubtask.get(t.id, text((await body(req)).title, 'Подзадача', MAX_TITLE), t.id);
    q.touch.run(t.id);
    return fetchOne(t.id, user.id);
  });

  // { title?, done? }
  router.on('PATCH', '/api/tasks/:id/subtasks/:sid', async ({ req, params, user }) => {
    const s = /** @type {any} */ (q.subtask.get(Number(params.sid), Number(params.id), user.id));
    if (!s) throw new HttpError(404, 'Подзадача не найдена');
    const b = await body(req);
    q.editSubtask.run(b.title === undefined ? s.title : text(b.title, 'Подзадача', MAX_TITLE), b.done === undefined ? s.done : b.done ? 1 : 0, s.id);
    q.touch.run(s.task_id);
    return fetchOne(s.task_id, user.id);
  });

  router.on('DELETE', '/api/tasks/:id/subtasks/:sid', ({ params, user }) => {
    const s = /** @type {any} */ (q.subtask.get(Number(params.sid), Number(params.id), user.id));
    if (!s) throw new HttpError(404, 'Подзадача не найдена');
    q.removeSubtask.run(s.id);
    return fetchOne(s.task_id, user.id);
  });

  router.on('POST', '/api/task-lists', async ({ req, user }) => {
    const b = await body(req);
    const { id } = /** @type {{ id: number }} */ (q.addList.get(user.id, text(b.title, 'Список', 100), optional(b.emoji)?.slice(0, 8) ?? null, user.id));
    return { id };
  });

  router.on('PATCH', '/api/task-lists/:id', async ({ req, params, user }) => {
    const l = /** @type {any} */ (q.lists.all(user.id)).find((/** @type {any} */ x) => x.id === Number(params.id));
    if (!l) throw new HttpError(404, 'Список не найден');
    const b = await body(req);
    q.editList.run(b.title === undefined ? l.title : text(b.title, 'Список', 100), b.emoji === undefined ? l.emoji : optional(b.emoji)?.slice(0, 8) ?? null, l.id);
    return { ok: true };
  });

  // The list's tasks stay, without a list.
  router.on('DELETE', '/api/task-lists/:id', ({ params, user }) => {
    if (!q.list.get(Number(params.id), user.id)) throw new HttpError(404, 'Список не найден');
    q.removeList.run(Number(params.id));
    return { ok: true };
  });
}
