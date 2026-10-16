// @ts-check
// An administrator's marks on messages are their tasks: marking a message take / work / done puts it
// in the marker's tasks (Мои задачи) with that tag and the status that goes with it (take — to do,
// work — doing, done — done), the way back to the message kept. A task already made from the message
// (by hand, "В задачи", or by an earlier mark) is updated, not repeated; the mark taken off takes off
// the tag, the task stays (it may hold notes). The other way: such a task moved between statuses
// moves the message's mark (api/tasks.js).
import { normTag } from '../shared/tasktags.js';
import { transaction } from './db.js';

export const MARK_TAGS = /** @type {const} */ (['take', 'work', 'done']);
/** @type {Record<string, 'todo' | 'doing' | 'done'>} */
export const MARK_STATUS = { take: 'todo', work: 'doing', done: 'done' };
/** @type {Record<string, string>} */
export const STATUS_MARK = { todo: 'take', doing: 'work', done: 'done' };

const PARA = /^\d+:\d+\.\d+$/;
const TITLE = 80;

/** A task's title from a message: its own words (not the quotes it carries), on one line. @param {string} body */
export function titleOf(body) {
  const own = body.split('\n').filter((l) => !/^\s*>/.test(l)).join(' ');
  const text = (own.trim() ? own : body.replace(/^\s*> ?/gm, '')).replace(/\s+/g, ' ').trim() || 'Сообщение';
  return text.length > TITLE ? `${text.slice(0, TITLE).trimEnd()}…` : text;
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createMarkTasks(db) {
  const q = {
    task: db.prepare('SELECT id, status, tags, done_at FROM tasks WHERE user_id = ? AND message_id = ? ORDER BY id LIMIT 1'),
    para: db.prepare('SELECT ref FROM paragraphs WHERE ref = ?'),
    insert: db.prepare(`
      INSERT INTO tasks (user_id, title, status, tags, ref, annotation_id, message_id, message_chat, done_at, pos)
      VALUES (:user, :title, :status, :tags, :ref, :annotationId, :messageId, :messageChat, :doneAt,
              (SELECT coalesce(min(pos), 0) - 1 FROM tasks WHERE user_id = :user))`),
    update: db.prepare("UPDATE tasks SET status = ?, tags = ?, done_at = ?, updated_at = datetime('now') WHERE id = ?"),
  };
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  /** Where the task stands in the book: the thread's paragraph, the note, or the first paragraph named. @param {{ chat: string, body: string }} m */
  function place(m) {
    if (PARA.test(m.chat)) return { ref: m.chat, annotationId: null };
    if (m.chat.startsWith('note:')) return { ref: null, annotationId: Number(m.chat.slice(5)) };
    const ref = [...m.body.matchAll(/\b\d{1,3}:\d{1,2}\.\d{1,3}\b/g)].map((x) => x[0]).find((x) => q.para.get(x)) ?? null;
    return { ref, annotationId: null };
  }

  const self = {
    /**
     * Once: messages marked before marks became tasks get their tasks (a flag in meta).
     * @returns {number} how many marked messages were gone through
     */
    backfill() {
      const KEY = 'marktasks.backfilled';
      if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(KEY)) return 0;
      const marked = /** @type {{ id: number, chat: string, body: string, mark: string, by: number }[]} */ (
        db.prepare("SELECT id, ref AS chat, body, mark, mark_by AS by FROM public_messages WHERE mark IS NOT NULL AND mark_by IS NOT NULL AND kind = 'message' ORDER BY mark_at").all()
      );
      transaction(db, () => {
        for (const m of marked) self.sync(m, m.by, m.mark);
        db.prepare("INSERT INTO meta (key, value) VALUES (?, datetime('now'))").run(KEY);
      });
      return marked.length;
    },

    /**
     * The message got a mark (or lost it): the marker's task follows. Call inside the mark's transaction.
     * @param {{ id: number, chat: string, body: string }} msg @param {number} userId @param {string | null} mark
     */
    sync(msg, userId, mark) {
      const t = /** @type {{ id: number, status: string, tags: string, done_at: string | null } | undefined} */ (q.task.get(userId, msg.id));
      const others = (/** @type {string[]} */ (t ? JSON.parse(t.tags) : [])).filter((x) => !MARK_TAGS.includes(/** @type {any} */ (normTag(x))));
      if (mark === null) {
        if (t) q.update.run(t.status, JSON.stringify(others), t.done_at, t.id);
        return;
      }
      const status = MARK_STATUS[mark];
      const doneAt = status === 'done' ? (t?.status === 'done' && t.done_at) || now() : null;
      const tags = JSON.stringify([...others, mark]);
      if (t) q.update.run(status, tags, doneAt, t.id);
      else q.insert.run({ user: userId, title: titleOf(msg.body), status, tags, ...place(msg), messageId: msg.id, messageChat: msg.chat, doneAt });
    },
  };
  return self;
}
