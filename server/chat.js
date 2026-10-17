// @ts-check
// Chat: every conversation of the platform, keyed by `ref` in public_messages — a paragraph thread
// ("5:1.2"), a channel ("chan:3"), a group workspace ("ws:2", members only), the comments of a note
// ("note:7", members of the note's workspace only). Replies, reactions, @mentions, read marks, and
// live updates over Server-Sent Events.
import { HttpError } from './http.js';
import { roleRank } from './auth.js';
import { transaction } from './db.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./auth.js').User} User */
/** @typedef {{ kind: 'para' | 'chan' | 'ws' | 'note' | 'dm' | string, id: string | number, key: string }} Chat */
/**
 * A kind of chat a feature adds (its keys "name:12"): open to every signed-in user, as a paragraph's thread.
 * `access` throws when there is no such thing (or it is not this user's to read / write); `header` — its
 * title, subtitle and the way to it (`link`: a path in the app, `linkLabel`).
 * @typedef {{
 *   access: (id: number, user: User, write: boolean) => void,
 *   header: (id: number, user: User) => { title: string, subtitle: string | null, link?: string, linkLabel?: string },
 * }} ChatKind
 */

const MAX_BODY = 20_000;

/**
 * When a message was written, as SQLite keeps times ("2026-10-15 07:32:10", UTC) — only if that was more
 * than a minute before now and within 30 days (written without a network); otherwise null.
 * @param {unknown} at an ISO time from the device
 */
export function writtenAt(at) {
  if (typeof at !== 'string') return null;
  const t = Date.parse(at);
  const now = Date.now();
  if (!Number.isFinite(t) || t > now - 60_000 || t < now - 30 * 86400_000) return null;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}
const PAGE = 60;
import { REACTIONS } from '../shared/reactions.js';
export { REACTIONS };
const PARA = /^\d+:\d+\.\d+$/;
const MENTION = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,40})/gu;
/** An administrator's marks on messages: taken — in work — done. */
export const MARKS = ['take', 'work', 'done'];

const OWN_KINDS = ['chan', 'ws', 'note', 'dm'];

/** @param {string} key @param {Map<string, ChatKind>} [more] the kinds features added @returns {Chat} */
export function parseKey(key, more) {
  if (PARA.test(key)) return { kind: 'para', id: key, key };
  const m = key.match(/^([a-z]+):(\d+)$/);
  if (!m || !(OWN_KINDS.includes(m[1]) || more?.has(m[1]))) throw new HttpError(404, 'Чат не найден');
  return { kind: m[1], id: Number(m[2]), key };
}

/**
 * Live updates: one SSE connection per open tab; events go to everyone who may see the chat.
 * @param {ReturnType<typeof import('./auth.js').createAuth>} auth
 * @param {(chat: Chat) => number | null} workspaceOf the workspace whose members alone see the chat
 * @param {(key: string) => Chat} parseKey
 */
function createHub(auth, workspaceOf, parseKey) {
  /** @type {Map<import('node:http').ServerResponse, number>} */
  const clients = new Map();
  setInterval(() => {
    for (const res of clients.keys()) res.write(': ping\n\n');
  }, 25_000).unref();
  return {
    /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {number} userId */
    subscribe(req, res, userId) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.set(res, userId);
      req.on('close', () => clients.delete(res));
    },
    /**
     * An event of one's own to each open tab: `pick` says what this person is to be told (null — nothing).
     * @param {(userId: number) => Record<string, unknown> | null} pick
     */
    tell(pick) {
      /** @type {Map<number, string | null>} */
      const said = new Map(); // (one person's tabs are told the same)
      for (const [res, uid] of clients) {
        if (!said.has(uid)) {
          const event = pick(uid);
          said.set(uid, event ? `data: ${JSON.stringify(event)}\n\n` : null);
        }
        const data = said.get(uid);
        if (data) res.write(data);
      }
    },
    /** @param {string} key @param {Record<string, unknown>} event */
    publish(key, event) {
      const c = parseKey(key);
      const ws = workspaceOf(c);
      const data = `data: ${JSON.stringify({ ...event, key })}\n\n`;
      for (const [res, uid] of clients) {
        if (c.kind === 'dm' && uid !== c.id) continue; // "Я и Книга": its owner alone
        if (ws !== null && !auth.role(ws, uid)) continue;
        res.write(data);
      }
    },
  };
}

/**
 * @param {DatabaseSync} db
 * @param {ReturnType<typeof import('./auth.js').createAuth>} auth
 */
export function createChat(db, auth) {
  /** The kinds of chat features added (`kind`). @type {Map<string, ChatKind>} */
  const kinds = new Map();
  /** @param {string} key */
  const keyOf = (key) => parseKey(key, kinds);
  const hub = createHub(auth, (c) => workspaceOf(c), keyOf);
  /** Called inside a mark's transaction (server/marktasks.js: the marker's task follows the mark). @type {((msg: any, userId: number, mark: string | null) => void) | null} */
  let markHook = null;
  const MESSAGE = `
    SELECT m.id, m.ref AS chat, m.proposal_id AS proposalId, m.kind, m.author_id AS authorId,
           coalesce(u.display_name, u.username) AS authorName, u.username AS authorUsername, m.body, m.hidden_at AS hiddenAt,
           m.reply_to AS replyTo, m.created_at AS createdAt, m.updated_at AS updatedAt, m.mark,
           m.anchor_ref AS anchorRef, m.anchor_lang AS anchorLang, m.anchor_start AS anchorStart, m.anchor_end AS anchorEnd,
           m.linked_id AS linkedId, u.is_agent AS authorAgent, m.written_at AS writtenAt
    FROM public_messages m LEFT JOIN users u ON u.id = m.author_id`;
  const q = {
    page: db.prepare(`${MESSAGE} WHERE m.ref = :key AND m.id < :before ORDER BY m.id DESC LIMIT :limit`),
    one: db.prepare(`${MESSAGE} WHERE m.id = ?`),
    reactions: db.prepare(`
      SELECT r.message_id AS messageId, r.emoji, count(*) AS n, max(r.user_id = :user) AS mine,
             group_concat(coalesce(u.display_name, u.username), ', ') AS who, group_concat(r.user_id) AS userIds
      FROM message_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.message_id IN (SELECT value FROM json_each(:ids)) GROUP BY r.message_id, r.emoji ORDER BY min(r.created_at)`),
    insert: db.prepare(`INSERT INTO public_messages (ref, proposal_id, author_id, body, reply_to, anchor_ref, anchor_lang, anchor_start, anchor_end, written_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
    setLinked: db.prepare('UPDATE public_messages SET linked_id = ? WHERE id = ?'),
    comments: db.prepare("SELECT count(*) AS n FROM public_messages WHERE reply_to = ? AND kind = 'message' AND hidden_at IS NULL"),
    isAgent: db.prepare('SELECT is_agent AS agent FROM users WHERE id = ?'),
    muted: db.prepare('SELECT chat FROM chat_mutes WHERE user_id = ?'),
    addMute: db.prepare('INSERT OR IGNORE INTO chat_mutes (user_id, chat) VALUES (?, ?)'),
    delMute: db.prepare('DELETE FROM chat_mutes WHERE user_id = ? AND chat = ?'),
    paragraph: db.prepare('SELECT ref FROM paragraphs WHERE ref = ?'),
    paraInfo: db.prepare(`
      SELECT p.plain_ru AS text, p.html_ru AS ru, p.html_en AS en, p.page_ref AS pageRef, p.paper_id AS paperId, pp.title_ru AS paperTitle, pp.title_en AS paperTitleEn
      FROM paragraphs p JOIN papers pp ON pp.id = p.paper_id WHERE p.ref = ?`),
    channel: db.prepare('SELECT id, title, description, archived, voice, discussion FROM channels WHERE id = ?'),
    channels: db.prepare('SELECT id, title, description, voice FROM channels WHERE archived = 0 ORDER BY id'),
    addChannel: db.prepare('INSERT INTO channels (title, description, created_by) VALUES (?, ?, ?) RETURNING id'),
    editChannel: db.prepare('UPDATE channels SET title = ?, description = ?, archived = ? WHERE id = ?'),
    workspace: db.prepare("SELECT id, name, kind, (SELECT count(*) FROM workspace_members x WHERE x.workspace_id = workspaces.id) AS members FROM workspaces WHERE id = ?"),
    // `members`: who can read the chat (shown as its visibility)
    myGroups: db.prepare(`SELECT w.id, w.name, (SELECT count(*) FROM workspace_members x WHERE x.workspace_id = w.id) AS members FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.kind = 'group' ORDER BY w.name`),
    followedRefs: db.prepare(`
      WITH taken(ref, since) AS (
        SELECT ref, created_at FROM public_messages WHERE author_id = :user AND kind = 'message'
        UNION ALL SELECT ref, created_at FROM proposals WHERE author_id = :user
        UNION ALL SELECT p.ref, v.created_at FROM votes v JOIN proposals p ON p.id = v.proposal_id WHERE v.user_id = :user
        UNION ALL SELECT ref, created_at FROM thread_follows WHERE user_id = :user AND follow = 1
      )
      SELECT t.ref, min(t.since) AS since, pp.title_ru AS paperTitle FROM taken t
      JOIN paragraphs pa ON pa.ref = t.ref JOIN papers pp ON pp.id = pa.paper_id
      WHERE t.ref NOT IN (SELECT ref FROM thread_follows WHERE user_id = :user AND follow = 0)
      GROUP BY t.ref`),
    // the chats of features' kinds one wrote in ("dict:12")
    written: db.prepare("SELECT ref AS chat, min(created_at) AS since FROM public_messages WHERE author_id = ? AND kind = 'message' AND ref GLOB '[a-z]*:[0-9]*' AND ref NOT GLOB 'chan:*' AND ref NOT GLOB 'ws:*' AND ref NOT GLOB 'note:*' AND ref NOT GLOB 'dm:*' GROUP BY ref"),
    last: db.prepare(`${MESSAGE} WHERE m.ref = ? AND m.hidden_at IS NULL ORDER BY m.id DESC LIMIT 1`),
    read: db.prepare('SELECT last_read_id AS id FROM chat_reads WHERE user_id = ? AND chat = ?'),
    setRead: db.prepare(`INSERT INTO chat_reads (user_id, chat, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT (user_id, chat) DO UPDATE SET last_read_id = max(last_read_id, excluded.last_read_id)`),
    unread: db.prepare(`
      SELECT count(*) AS n, total(EXISTS (SELECT 1 FROM mentions WHERE message_id = m.id AND user_id = :user)) AS mentions
      FROM public_messages m
      WHERE m.ref = :key AND m.kind = 'message' AND m.hidden_at IS NULL AND m.id > :after
        AND (m.author_id IS NULL OR m.author_id != :user) AND m.created_at >= :since`),
    userSince: db.prepare('SELECT created_at AS since FROM users WHERE id = ?'),
    users: db.prepare(`SELECT id, username, coalesce(display_name, username) AS name FROM users
      WHERE disabled = 0 AND (username_key LIKE :q OR lower(coalesce(display_name, '')) LIKE :q) ORDER BY username LIMIT 8`),
    userByName: db.prepare('SELECT id FROM users WHERE username_key = ? AND disabled = 0'),
    addMention: db.prepare('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)'),
    clearMentions: db.prepare('DELETE FROM mentions WHERE message_id = ?'),
    hasReaction: db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
    addReaction: db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'),
    removeReaction: db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
    unmute: db.prepare('DELETE FROM thread_follows WHERE user_id = ? AND ref = ? AND follow = 0'),
    note: db.prepare(`
      SELECT a.workspace_id AS ws, a.author_id AS authorId, a.ref, a.quote, a.title, a.bookmark, w.name AS wsName, w.kind AS wsKind
      FROM annotations a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = ?`),
    channelBy: db.prepare('SELECT created_by AS by FROM channels WHERE id = ?'),
    pinned: db.prepare('SELECT message_id AS id FROM chat_pins WHERE chat = ?'),
    pin: db.prepare(`INSERT INTO chat_pins (chat, message_id, pinned_by) VALUES (?, ?, ?)
      ON CONFLICT (chat) DO UPDATE SET message_id = excluded.message_id, pinned_by = excluded.pinned_by, pinned_at = datetime('now')`),
    unpin: db.prepare('DELETE FROM chat_pins WHERE chat = ?'),
    setMark: db.prepare("UPDATE public_messages SET mark = ?, mark_by = ?, mark_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ?"),
    markNote: db.prepare("INSERT INTO public_messages (ref, kind, author_id, body, reply_to) VALUES (?, 'event', ?, ?, ?) RETURNING id"),
    // a conversation's messages for its search (the words are matched in JS: SQLite's lower() is ASCII only)
    search: db.prepare(`${MESSAGE} WHERE m.ref = :key AND m.kind = 'message' AND m.hidden_at IS NULL AND (:mark IS NULL OR m.mark = :mark) ORDER BY m.id DESC`),
    marked: db.prepare(`${MESSAGE} WHERE m.mark IS NOT NULL AND (:mark IS NULL OR m.mark = :mark) ORDER BY m.mark_at DESC LIMIT 200`),
    myPinned: db.prepare('SELECT chat FROM pinned_chats WHERE user_id = ? ORDER BY pos'),
    clearPinned: db.prepare('DELETE FROM pinned_chats WHERE user_id = ?'),
    addPinned: db.prepare('INSERT INTO pinned_chats (user_id, chat, pos) VALUES (?, ?, ?)'),
  };
  const MAX_PINNED = 10;
  /** @type {((key: string, user: User, msg: any) => void)[]} */
  const direct = [];

  /** The workspace whose members alone see a chat (null: open to every signed-in user). @param {Chat} c */
  function workspaceOf(c) {
    if (c.kind === 'ws') return Number(c.id);
    if (c.kind === 'note') return /** @type {{ ws: number } | undefined} */ (q.note.get(c.id))?.ws ?? -1;
    return null;
  }

  /**
   * Who may read / write a chat. Paragraph threads and channels are open to every signed-in user;
   * a workspace chat to its members, a note's comments to the members of the note's workspace
   * (writing from "commenter" up).
   * @param {string} key @param {User} user @param {boolean} write
   */
  function access(key, user, write) {
    const c = keyOf(key);
    if (c.kind === 'para' && !q.paragraph.get(c.id)) throw new HttpError(404, `Абзац ${c.id} не найден`);
    kinds.get(c.kind)?.access(Number(c.id), user, write);
    if (c.kind === 'chan') {
      const ch = /** @type {any} */ (q.channel.get(c.id));
      if (!ch) throw new HttpError(404, 'Канал не найден');
      if (write && ch.archived) throw new HttpError(400, 'Канал в архиве');
      if (write && ch.voice && !isAgent(user)) throw new HttpError(403, 'В этом канале говорит Книга; обсуждение — в «Общем»');
    }
    if (c.kind === 'ws') {
      const role = auth.role(Number(c.id), user.id);
      const ws = /** @type {any} */ (q.workspace.get(c.id));
      if (!role || !ws || ws.kind !== 'group') throw new HttpError(404, 'Чат не найден');
      if (write && roleRank(role) < roleRank('commenter')) throw new HttpError(403, 'Писать в чат пространства могут комментаторы и выше');
    }
    if (c.kind === 'dm' && c.id !== user.id && !isAgent(user)) throw new HttpError(404, 'Чат не найден'); // one's own, and the Book's
    if (c.kind === 'note') {
      const n = /** @type {{ ws: number } | undefined} */ (q.note.get(c.id));
      const role = n ? auth.role(n.ws, user.id) : null;
      if (!role) throw new HttpError(404, 'Заметка не найдена');
      if (write && roleRank(role) < roleRank('commenter')) throw new HttpError(403, 'Комментировать могут комментаторы и выше');
    }
    return c;
  }

  /** Messages with their reactions and the quoted message of a reply. @param {any[]} rows @param {User} user */
  function present(rows, user) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const byMsg = Map.groupBy(/** @type {any[]} */ (q.reactions.all({ ids: JSON.stringify(ids), user: user.id })), (r) => r.messageId);
    const quoted = new Map();
    for (const r of rows) {
      if (r.replyTo && !quoted.has(r.replyTo)) {
        const o = /** @type {any} */ (q.one.get(r.replyTo));
        quoted.set(r.replyTo, o && { id: o.id, authorName: o.authorName, body: o.hiddenAt ? '' : o.body.slice(0, 200) });
      }
    }
    return rows.map((r) => ({
      ...r,
      authorAgent: !!r.authorAgent,
      ...(r.anchorRef ? { post: postOf(r.anchorRef) } : {}),
      ...(r.linkedId ? { comments: /** @type {{ n: number }} */ (q.comments.get(r.linkedId)).n } : {}),
      body: r.hiddenAt && r.authorId !== user.id && !(user.isCoordinator || user.isAdmin) ? '' : r.body,
      reply: r.replyTo ? quoted.get(r.replyTo) ?? null : null,
      reactions: (byMsg.get(r.id) ?? []).map(({ messageId, mine, ...x }) => ({ ...x, mine: !!mine })),
    }));
  }

  /** The paragraph a message is anchored to, to draw it as a post. @param {string} ref */
  function postOf(ref) {
    const p = /** @type {any} */ (q.paraInfo.get(ref));
    return p ? { ref, ru: p.ru, en: p.en, pageRef: p.pageRef, paperId: p.paperId, paperTitle: p.paperTitle, paperTitleEn: p.paperTitleEn } : null;
  }
  /** The Book (and later other agents) — not a person. @param {User} user */
  const isAgent = (user) => !!(/** @type {{ agent: number } | undefined} */ (q.isAgent.get(user.id))?.agent);

  /** @param {number} id @param {User} user */
  const fetchOne = (id, user) => present([q.one.get(id)], user)[0];

  /**
   * Mentions (@name) of existing users → rows; in a members-only chat only members can be mentioned
   * (a mention is a notification with the message in it).
   * @param {number} id @param {string} body @param {string} key
   */
  function saveMentions(id, body, key) {
    q.clearMentions.run(id);
    const ws = workspaceOf(keyOf(key));
    for (const m of body.matchAll(MENTION)) {
      const u = /** @type {{ id: number } | undefined} */ (q.userByName.get(m[2].toLowerCase()));
      if (u && (ws === null || auth.role(ws, u.id))) q.addMention.run(id, u.id);
    }
  }

  /**
   * Who may pin a message: whoever made the chat — a channel's creator, a workspace's owner, a note's
   * author (or the owner of its workspace) — and an administrator; paragraph threads have no maker.
   * @param {Chat} c @param {User} user
   */
  function canPin(c, user) {
    if (user.isAdmin) return true;
    if (c.kind === 'chan') return /** @type {{ by: number | null } | undefined} */ (q.channelBy.get(c.id))?.by === user.id;
    if (c.kind === 'ws') return auth.role(Number(c.id), user.id) === 'owner';
    if (c.kind === 'note') {
      const n = /** @type {{ ws: number, authorId: number | null } | undefined} */ (q.note.get(c.id));
      return !!n && (n.authorId === user.id || auth.role(n.ws, user.id) === 'owner');
    }
    return false;
  }

  /** The chat's pinned message, short. @param {string} key @param {User} user */
  function pinnedOf(key, user) {
    const p = /** @type {{ id: number } | undefined} */ (q.pinned.get(key));
    const m = p && present([q.one.get(p.id)], user)[0];
    return m ? { id: m.id, authorName: m.authorName, body: m.body.slice(0, 300), hiddenAt: m.hiddenAt } : null;
  }

  /** @param {string} key @param {User} user */
  function unreadOf(key, user, since = '') {
    const after = /** @type {{ id: number } | undefined} */ (q.read.get(user.id, key))?.id ?? 0;
    const base = since || /** @type {{ since: string }} */ (q.userSince.get(user.id)).since;
    return /** @type {{ n: number, mentions: number }} */ (q.unread.get({ key, user: user.id, after, since: base }));
  }

  return {
    hub,
    access,
    present,
    fetchOne,
    workspaceOf: (/** @type {string} */ key) => workspaceOf(keyOf(key)),

    /** A feature's kind of chat (its keys "name:12"). @param {string} name @param {ChatKind} def */
    kind(name, def) {
      if (!/^[a-z]+$/.test(name) || OWN_KINDS.includes(name) || kinds.has(name)) throw new Error(`Chat kind taken: ${name}`);
      kinds.set(name, def);
    },

    /** The owner of a members-only chat's workspace may delete others' messages there. @param {string} key @param {User} user */
    ownsChat(key, user) {
      const ws = workspaceOf(keyOf(key));
      return ws !== null && auth.role(ws, user.id) === 'owner';
    },

    /** Older messages first. @param {string} key @param {User} user @param {number} [before] */
    page(key, user, before) {
      access(key, user, false);
      const rows = /** @type {any[]} */ (q.page.all({ key, before: before ?? Number.MAX_SAFE_INTEGER, limit: PAGE })).reverse();
      return present(rows, user);
    },

    /**
     * A new message; also the path of paragraph-thread messages written elsewhere in the app.
     * `anchor`: the place in the book the message is about (the Book's posts). `writtenAt`: when it was
     * written, if without a network and sent later (the device's queue) — shown as its time.
     * @param {string} key @param {User} user
     * @param {{ body: unknown, replyTo?: unknown, proposalId?: number | null, anchor?: { ref: string, lang?: 'ru' | 'en' | null, start?: number | null, end?: number | null } | null, writtenAt?: unknown }} m
     */
    post(key, user, m) {
      const c = access(key, user, true);
      if (typeof m.body !== 'string' || !m.body.trim()) throw new HttpError(400, 'Сообщение: пусто');
      if (m.body.length > MAX_BODY) throw new HttpError(400, `Сообщение: длиннее ${MAX_BODY} символов`);
      let replyTo = null;
      if (m.replyTo !== undefined && m.replyTo !== null) {
        const r = /** @type {any} */ (q.one.get(Number(m.replyTo)));
        if (!r || r.chat !== key) throw new HttpError(400, 'Ответ на сообщение из другого чата');
        replyTo = r.id;
      }
      const a = m.anchor ?? null;
      if (a && !q.paragraph.get(a.ref)) throw new HttpError(400, `Абзац ${a.ref} не найден`);
      const { id } = /** @type {{ id: number }} */ (
        q.insert.get(key, m.proposalId ?? null, user.id, m.body.trim(), replyTo, a?.ref ?? null, a?.lang ?? null, a?.start ?? null, a?.end ?? null, writtenAt(m.writtenAt))
      );
      saveMentions(id, m.body, key);
      q.setRead.run(user.id, key, id);
      if (c.kind === 'para') q.unmute.run(user.id, key); // writing in a muted thread follows it again
      const msg = fetchOne(id, user);
      hub.publish(key, { type: 'message', message: { ...msg, reactions: [] } });
      if (c.kind === 'dm' && !isAgent(user)) for (const fn of direct) fn(key, user, msg); // the Book answers
      return msg;
    },

    /** After an edit (the body is already saved). @param {number} id @param {User} user */
    edited(id, user) {
      const msg = /** @type {any} */ (q.one.get(id));
      if (!msg) return;
      saveMentions(id, msg.body, msg.chat);
      hub.publish(msg.chat, { type: 'edit', id, body: msg.body, updatedAt: msg.updatedAt });
      return fetchOne(id, user);
    },
    /** @param {string} key @param {number} id */
    deleted(key, id) {
      hub.publish(key, { type: 'delete', id });
    },
    /** @param {number} id */
    changed(id) {
      const msg = /** @type {any} */ (q.one.get(id));
      if (msg) hub.publish(msg.chat, { type: 'reload' });
    },

    /**
     * An administrator's mark on a message: take / work / done, or null to take it off. Everyone in the
     * chat sees it on the message; its author is told (a mention in the hidden "mark:<chat>").
     * @param {number} id @param {User} user @param {unknown} mark
     */
    mark(id, user, mark) {
      if (!user.isAdmin) throw new HttpError(403, 'Отмечать сообщения может администратор');
      if (mark !== null && !MARKS.includes(/** @type {string} */ (mark))) throw new HttpError(400, 'Отметка: take, work или done');
      const m = /** @type {string | null} */ (mark); // (checked above)
      const msg = /** @type {any} */ (q.one.get(id));
      if (!msg || msg.kind !== 'message') throw new HttpError(404, 'Сообщение не найдено');
      access(msg.chat, user, false);
      transaction(db, () => {
        q.setMark.run(m, m === null ? null : user.id, m, id);
        markHook?.(msg, user.id, m);
        if (m !== null && msg.authorId && msg.authorId !== user.id) {
          const { id: note } = /** @type {{ id: number }} */ (q.markNote.get(`mark:${msg.chat}`, user.id, m, id));
          q.addMention.run(note, msg.authorId);
        }
      });
      hub.publish(msg.chat, { type: 'mark', id, mark });
      return fetchOne(id, user);
    },

    /** @param {(msg: any, userId: number, mark: string | null) => void} fn */
    setMarkHook(fn) {
      markHook = fn;
    },

    /**
     * The search in a conversation (the magnifier in its header): messages with the words, and/or with a
     * mark (take / work / done), newest first, up to 100. @param {string} key @param {User} user
     * @param {string} text @param {string | null} mark
     */
    search(key, user, text, mark) {
      access(key, user, false);
      if (mark !== null && !MARKS.includes(mark)) throw new HttpError(400, 'Отметка: take, work или done');
      const words = text.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
      if (!words.length && mark === null) return [];
      const rows = /** @type {any[]} */ (q.search.all({ key, mark })).filter((m) => {
        const body = String(m.body ?? '').toLowerCase().replace(/ё/g, 'е');
        return words.every((w) => body.includes(w));
      });
      return present(rows.slice(0, 100), user);
    },

    /**
     * Marked messages for the chat list's filter (newest marks first), only from chats the user may read,
     * with the chat's title. @param {User} user @param {string | null} mark
     */
    marked(user, mark) {
      if (mark !== null && !MARKS.includes(mark)) throw new HttpError(400, 'Отметка: take, work или done');
      const rows = /** @type {any[]} */ (q.marked.all({ mark })).filter((m) => {
        try {
          access(m.chat, user, false);
          return true;
        } catch {
          return false;
        }
      });
      /** @type {Map<string, string>} */
      const titles = new Map();
      const titleOf = (/** @type {string} */ key) => {
        if (!titles.has(key)) titles.set(key, this.header(key, user).title);
        return /** @type {string} */ (titles.get(key));
      };
      return present(rows, user).map((m) => ({ ...m, chatTitle: titleOf(m.chat) }));
    },

    /** Toggles a reaction. @param {number} id @param {User} user @param {unknown} emoji */
    react(id, user, emoji) {
      if (typeof emoji !== 'string' || !REACTIONS.includes(emoji)) throw new HttpError(400, 'Неизвестная реакция');
      const msg = /** @type {any} */ (q.one.get(id));
      if (!msg || msg.kind !== 'message') throw new HttpError(404, 'Сообщение не найдено');
      access(msg.chat, user, false);
      if (q.hasReaction.get(id, user.id, emoji)) q.removeReaction.run(id, user.id, emoji);
      else q.addReaction.run(id, user.id, emoji);
      // Everyone gets the counts; each client tells its own reaction from userIds.
      const all = /** @type {any[]} */ (q.reactions.all({ ids: JSON.stringify([id]), user: 0 }));
      hub.publish(msg.chat, { type: 'reactions', id, reactions: all.map(({ messageId, mine, ...x }) => x), by: user.id, emoji });
      return fetchOne(id, user).reactions;
    },

    /** @param {string} key @param {User} user @param {number} upTo */
    markRead(key, user, upTo) {
      access(key, user, false);
      q.setRead.run(user.id, key, upTo);
    },

    /** "печатает…" @param {string} key @param {User} user */
    typing(key, user) {
      access(key, user, true);
      hub.publish(key, { type: 'typing', userId: user.id, name: user.displayName ?? user.username });
    },

    /**
     * The chat list: channels, the user's group workspaces, followed paragraph threads; the user's pinned
     * chats first in their order (`pinned`: 0…9, a pinned paragraph thread stays even if no longer
     * followed), then the rest newest first.
     * @param {User} user
     */
    list(user) {
      /** @type {any[]} */
      const out = [];
      const pinned = /** @type {{ chat: string }[]} */ (q.myPinned.all(user.id)).map((p) => p.chat);
      const muted = new Set(/** @type {{ chat: string }[]} */ (q.muted.all(user.id)).map((m) => m.chat));
      const add = (/** @type {string} */ key, /** @type {Record<string, unknown>} */ info, since = '') => {
        if (out.some((c) => c.key === key)) return;
        const last = /** @type {any} */ (q.last.get(key));
        const u = unreadOf(key, user, since);
        const pos = pinned.indexOf(key);
        out.push({ key, ...info, last: last ? present([last], user)[0] : null, unread: u.n, mentions: u.mentions, pinned: pos < 0 ? null : pos, muted: muted.has(key) });
      };
      // "Я и Книга": one's own conversation with the Book, always in the list
      add(`dm:${user.id}`, { kind: 'dm', title: 'Я и Книга', subtitle: 'Спросите — Книга ответит своими словами' });
      for (const ch of /** @type {any[]} */ (q.channels.all())) add(`chan:${ch.id}`, { kind: 'chan', title: ch.title, subtitle: ch.description, voice: !!ch.voice });
      for (const w of /** @type {any[]} */ (q.myGroups.all(user.id))) add(`ws:${w.id}`, { kind: 'ws', title: w.name, subtitle: 'Рабочее пространство', members: w.members });
      for (const t of /** @type {any[]} */ (q.followedRefs.all({ user: user.id }))) {
        add(t.ref, { kind: 'para', title: `Абзац ${t.ref}`, subtitle: t.paperTitle }, t.since);
      }
      // a feature's chats: those one wrote in, and the pinned ones
      /** @param {string} key @param {string} [since] */
      const addMore = (key, since) => {
        try {
          const c = keyOf(key);
          const more = kinds.get(c.kind);
          if (more && !out.some((x) => x.key === key)) (access(key, user, false), add(key, { kind: c.kind, ...more.header(Number(c.id), user) }, since));
        } catch {} // (gone, or not this user's any more)
      };
      for (const t of /** @type {{ chat: string, since: string }[]} */ (q.written.all(user.id))) addMore(t.chat, t.since);
      for (const key of pinned) {
        addMore(key);
        if (!PARA.test(key) || out.some((c) => c.key === key) || !q.paragraph.get(key)) continue;
        const p = /** @type {any} */ (q.paraInfo.get(key));
        add(key, { kind: 'para', title: `Абзац ${key}`, subtitle: p?.paperTitle ?? null });
      }
      return out.sort((a, b) => (a.pinned ?? MAX_PINNED) - (b.pinned ?? MAX_PINNED) || (b.last?.id ?? 0) - (a.last?.id ?? 0));
    },

    /**
     * The user's pinned chats, in order (pinning, unpinning and reordering all send the whole list).
     * Only chats of the user's list; at most 10.
     * @param {User} user @param {unknown} keys
     */
    setPinned(user, keys) {
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) throw new HttpError(400, 'Нужен список чатов');
      const list = [...new Set(/** @type {string[]} */ (keys))];
      if (list.length > MAX_PINNED) throw new HttpError(400, `Закрепить можно до ${MAX_PINNED} чатов`);
      for (const k of list) {
        const c = keyOf(k);
        if (c.kind === 'note') throw new HttpError(400, 'Обсуждения заметок не закрепляются в списке');
        access(k, user, false);
      }
      transaction(db, () => {
        q.clearPinned.run(user.id);
        list.forEach((k, i) => q.addPinned.run(user.id, k, i));
      });
      return { pinned: list };
    },

    /** Total unread messages and mentions over the chat list (for the icon in the top bar). @param {User} user */
    unreadTotal(user) {
      // a muted chat's messages are not news; mentions in it still are
      return this.list(user).reduce((s, c) => ({ unread: s.unread + (c.muted ? 0 : c.unread), mentions: s.mentions + c.mentions }), { unread: 0, mentions: 0 });
    },

    /**
     * Pins a message of the chat (replacing the pinned one) or, with null, unpins.
     * @param {string} key @param {User} user @param {unknown} messageId
     */
    pin(key, user, messageId) {
      const c = access(key, user, false);
      if (!canPin(c, user)) throw new HttpError(403, 'Закреплять может создатель чата или администратор');
      if (messageId === null || messageId === undefined) q.unpin.run(key);
      else {
        const m = /** @type {any} */ (q.one.get(Number(messageId)));
        if (!m || m.chat !== key || m.kind !== 'message') throw new HttpError(400, 'Сообщение не из этого чата');
        q.pin.run(key, m.id, user.id);
      }
      hub.publish(key, { type: 'pin' });
      return { pinned: pinnedOf(key, user) };
    },

    /**
     * Listens to what people write to the Book ("Я и Книга"). @param {(key: string, user: User, msg: any) => void} fn
     */
    onDirect(fn) {
      direct.push(fn);
    },

    /** Mutes or unmutes a chat for the user (its news is not counted). @param {string} key @param {User} user @param {boolean} on */
    mute(key, user, on) {
      access(key, user, false);
      if (on) q.addMute.run(user.id, key);
      else q.delMute.run(user.id, key);
      return { muted: on };
    },

    /** A channel post keeps the way to its copy in the discussion. @param {number} id @param {number} linkedId */
    link(id, linkedId) {
      q.setLinked.run(linkedId, id);
    },

    /** One chat's header info, with its pinned message and whether the user may pin. @param {string} key @param {User} user */
    info(key, user) {
      return { ...this.header(key, user), pinned: pinnedOf(key, user), canPin: canPin(keyOf(key), user) };
    },

    /** @param {string} key @param {User} user */
    header(key, user) {
      const c = access(key, user, false);
      if (c.kind === 'chan') {
        const ch = /** @type {any} */ (q.channel.get(c.id));
        return { key, kind: 'chan', title: ch.title, subtitle: ch.description, archived: !!ch.archived, voice: !!ch.voice, discussion: ch.discussion ?? null };
      }
      if (c.kind === 'ws') {
        const w = /** @type {any} */ (q.workspace.get(c.id));
        return { key, kind: 'ws', title: w.name, subtitle: 'Рабочее пространство', members: w.members };
      }
      const more = kinds.get(c.kind);
      if (more) return { key, kind: c.kind, ...more.header(Number(c.id), user) };
      if (c.kind === 'dm') return { key, kind: 'dm', title: 'Я и Книга', subtitle: 'Спросите — Книга ответит своими словами', private: true };
      if (c.kind === 'note') {
        const n = /** @type {any} */ (q.note.get(c.id));
        const w = /** @type {any} */ (q.workspace.get(n.ws));
        return {
          key, kind: 'note', title: `Заметка · ${n.ref}`, subtitle: n.wsKind === 'personal' ? 'Личное пространство' : n.wsName,
          members: w?.members ?? 1, ref: n.ref, workspaceId: n.ws, quote: n.quote,
        };
      }
      const p = /** @type {any} */ (q.paraInfo.get(key));
      return {
        key, kind: 'para', title: `Абзац ${key}`, subtitle: p?.paperTitle ?? null, text: p?.text ?? '',
        following: /** @type {{ ref: string }[]} */ (q.followedRefs.all({ user: user.id })).some((t) => t.ref === key),
        post: p ? { ru: p.ru, en: p.en, pageRef: p.pageRef, paperId: p.paperId, paperTitle: p.paperTitle, paperTitleEn: p.paperTitleEn } : null,
      };
    },

    /**
     * Whom to mention; for a members-only chat — its members only.
     * @param {string} prefix @param {User} user @param {string | null} [key]
     */
    users(prefix, user, key) {
      const list = /** @type {{ id: number }[]} */ (q.users.all({ q: `${prefix.toLowerCase().replace(/[%_]/g, '')}%` }));
      if (!key) return list;
      const ws = workspaceOf(access(key, user, false));
      return ws === null ? list : list.filter((u) => auth.role(ws, u.id));
    },

    channels: {
      /** @param {Record<string, unknown>} b @param {User} user */
      create(b, user) {
        if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 100) throw new HttpError(400, 'Название канала: до 100 символов');
        const desc = typeof b.description === 'string' && b.description.trim() ? b.description.trim().slice(0, 500) : null;
        return /** @type {{ id: number }} */ (q.addChannel.get(b.title.trim(), desc, user.id)).id;
      },
      /** @param {number} id @param {Record<string, unknown>} b */
      update(id, b) {
        const ch = /** @type {any} */ (q.channel.get(id));
        if (!ch) throw new HttpError(404, 'Канал не найден');
        q.editChannel.run(
          typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 100) : ch.title,
          b.description === undefined ? ch.description : typeof b.description === 'string' && b.description.trim() ? b.description.trim().slice(0, 500) : null,
          b.archived === undefined ? ch.archived : b.archived ? 1 : 0,
          id,
        );
      },
    },
  };
}
