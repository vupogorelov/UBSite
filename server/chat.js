// @ts-check
// Chat: every conversation of the public layer, keyed by `ref` in public_messages —
// a paragraph thread ("5:1.2"), a channel ("chan:3"), a group workspace ("ws:2", members only).
// Replies, reactions, @mentions, read marks, and live updates over Server-Sent Events.
import { HttpError } from './http.js';
import { roleRank } from './auth.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('./auth.js').User} User */
/** @typedef {{ kind: 'para' | 'chan' | 'ws', id: string | number, key: string }} Chat */

const MAX_BODY = 20_000;
const PAGE = 60;
import { REACTIONS } from '../shared/reactions.js';
export { REACTIONS };
const PARA = /^\d+:\d+\.\d+$/;
const MENTION = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,40})/gu;

/** @param {string} key @returns {Chat} */
export function parseKey(key) {
  if (PARA.test(key)) return { kind: 'para', id: key, key };
  const m = key.match(/^(chan|ws):(\d+)$/);
  if (!m) throw new HttpError(404, 'Чат не найден');
  return { kind: /** @type {'chan' | 'ws'} */ (m[1]), id: Number(m[2]), key };
}

/**
 * Live updates: one SSE connection per open tab; events go to everyone who may see the chat.
 * @param {ReturnType<typeof import('./auth.js').createAuth>} auth
 */
function createHub(auth) {
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
    /** @param {string} key @param {Record<string, unknown>} event */
    publish(key, event) {
      const chat = parseKey(key);
      const data = `data: ${JSON.stringify({ ...event, key })}\n\n`;
      for (const [res, uid] of clients) {
        if (chat.kind === 'ws' && !auth.role(Number(chat.id), uid)) continue;
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
  const hub = createHub(auth);
  const MESSAGE = `
    SELECT m.id, m.ref AS chat, m.proposal_id AS proposalId, m.kind, m.author_id AS authorId,
           coalesce(u.display_name, u.username) AS authorName, u.username AS authorUsername, m.body, m.hidden_at AS hiddenAt,
           m.reply_to AS replyTo, m.created_at AS createdAt, m.updated_at AS updatedAt
    FROM public_messages m LEFT JOIN users u ON u.id = m.author_id`;
  const q = {
    page: db.prepare(`${MESSAGE} WHERE m.ref = :key AND m.id < :before ORDER BY m.id DESC LIMIT :limit`),
    one: db.prepare(`${MESSAGE} WHERE m.id = ?`),
    reactions: db.prepare(`
      SELECT r.message_id AS messageId, r.emoji, count(*) AS n, max(r.user_id = :user) AS mine,
             group_concat(coalesce(u.display_name, u.username), ', ') AS who, group_concat(r.user_id) AS userIds
      FROM message_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.message_id IN (SELECT value FROM json_each(:ids)) GROUP BY r.message_id, r.emoji ORDER BY min(r.created_at)`),
    insert: db.prepare('INSERT INTO public_messages (ref, proposal_id, author_id, body, reply_to) VALUES (?, ?, ?, ?, ?) RETURNING id'),
    paragraph: db.prepare('SELECT ref FROM paragraphs WHERE ref = ?'),
    paraInfo: db.prepare(`
      SELECT p.plain_ru AS text, p.html_ru AS ru, p.html_en AS en, p.page_ref AS pageRef, p.paper_id AS paperId, pp.title_ru AS paperTitle
      FROM paragraphs p JOIN papers pp ON pp.id = p.paper_id WHERE p.ref = ?`),
    channel: db.prepare('SELECT id, title, description, archived FROM channels WHERE id = ?'),
    channels: db.prepare('SELECT id, title, description FROM channels WHERE archived = 0 ORDER BY id'),
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
  };

  /**
   * Who may read / write a chat. Paragraph threads and channels are open to every signed-in user;
   * a workspace chat to its members (writing from "commenter" up).
   * @param {string} key @param {User} user @param {boolean} write
   */
  function access(key, user, write) {
    const c = parseKey(key);
    if (c.kind === 'para' && !q.paragraph.get(c.id)) throw new HttpError(404, `Абзац ${c.id} не найден`);
    if (c.kind === 'chan') {
      const ch = /** @type {any} */ (q.channel.get(c.id));
      if (!ch) throw new HttpError(404, 'Канал не найден');
      if (write && ch.archived) throw new HttpError(400, 'Канал в архиве');
    }
    if (c.kind === 'ws') {
      const role = auth.role(Number(c.id), user.id);
      const ws = /** @type {any} */ (q.workspace.get(c.id));
      if (!role || !ws || ws.kind !== 'group') throw new HttpError(404, 'Чат не найден');
      if (write && roleRank(role) < roleRank('commenter')) throw new HttpError(403, 'Писать в чат пространства могут комментаторы и выше');
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
      body: r.hiddenAt && r.authorId !== user.id && !(user.isCoordinator || user.isAdmin) ? '' : r.body,
      reply: r.replyTo ? quoted.get(r.replyTo) ?? null : null,
      reactions: (byMsg.get(r.id) ?? []).map(({ messageId, mine, ...x }) => ({ ...x, mine: !!mine })),
    }));
  }

  /** @param {number} id @param {User} user */
  const fetchOne = (id, user) => present([q.one.get(id)], user)[0];

  /** @mentions of existing users → rows. @param {number} id @param {string} body */
  function saveMentions(id, body) {
    q.clearMentions.run(id);
    for (const m of body.matchAll(MENTION)) {
      const u = /** @type {{ id: number } | undefined} */ (q.userByName.get(m[2].toLowerCase()));
      if (u) q.addMention.run(id, u.id);
    }
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

    /** Older messages first. @param {string} key @param {User} user @param {number} [before] */
    page(key, user, before) {
      access(key, user, false);
      const rows = /** @type {any[]} */ (q.page.all({ key, before: before ?? Number.MAX_SAFE_INTEGER, limit: PAGE })).reverse();
      return present(rows, user);
    },

    /**
     * A new message; also the path of paragraph-thread messages written elsewhere in the app.
     * @param {string} key @param {User} user @param {{ body: unknown, replyTo?: unknown, proposalId?: number | null }} m
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
      const { id } = /** @type {{ id: number }} */ (q.insert.get(key, m.proposalId ?? null, user.id, m.body.trim(), replyTo));
      saveMentions(id, m.body);
      q.setRead.run(user.id, key, id);
      if (c.kind === 'para') q.unmute.run(user.id, key); // writing in a muted thread follows it again
      const msg = fetchOne(id, user);
      hub.publish(key, { type: 'message', message: { ...msg, reactions: [] } });
      return msg;
    },

    /** After an edit (the body is already saved). @param {number} id @param {User} user */
    edited(id, user) {
      const msg = /** @type {any} */ (q.one.get(id));
      if (!msg) return;
      saveMentions(id, msg.body);
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

    /** The chat list: channels, the user's group workspaces, followed paragraph threads; newest first. @param {User} user */
    list(user) {
      /** @type {any[]} */
      const out = [];
      const add = (/** @type {string} */ key, /** @type {Record<string, unknown>} */ info, since = '') => {
        const last = /** @type {any} */ (q.last.get(key));
        const u = unreadOf(key, user, since);
        out.push({ key, ...info, last: last ? present([last], user)[0] : null, unread: u.n, mentions: u.mentions });
      };
      for (const ch of /** @type {any[]} */ (q.channels.all())) add(`chan:${ch.id}`, { kind: 'chan', title: ch.title, subtitle: ch.description });
      for (const w of /** @type {any[]} */ (q.myGroups.all(user.id))) add(`ws:${w.id}`, { kind: 'ws', title: w.name, subtitle: 'Рабочее пространство', members: w.members });
      for (const t of /** @type {any[]} */ (q.followedRefs.all({ user: user.id }))) {
        add(t.ref, { kind: 'para', title: `Абзац ${t.ref}`, subtitle: t.paperTitle }, t.since);
      }
      return out.sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
    },

    /** Total unread messages and mentions over the chat list (for the icon in the top bar). @param {User} user */
    unreadTotal(user) {
      return this.list(user).reduce((s, c) => ({ unread: s.unread + c.unread, mentions: s.mentions + c.mentions }), { unread: 0, mentions: 0 });
    },

    /** One chat's header info. @param {string} key @param {User} user */
    info(key, user) {
      const c = access(key, user, false);
      if (c.kind === 'chan') {
        const ch = /** @type {any} */ (q.channel.get(c.id));
        return { key, kind: 'chan', title: ch.title, subtitle: ch.description, archived: !!ch.archived };
      }
      if (c.kind === 'ws') {
        const w = /** @type {any} */ (q.workspace.get(c.id));
        return { key, kind: 'ws', title: w.name, subtitle: 'Рабочее пространство', members: w.members };
      }
      const p = /** @type {any} */ (q.paraInfo.get(key));
      return {
        key, kind: 'para', title: `Абзац ${key}`, subtitle: p?.paperTitle ?? null, text: p?.text ?? '',
        post: p ? { ru: p.ru, en: p.en, pageRef: p.pageRef, paperId: p.paperId, paperTitle: p.paperTitle } : null,
      };
    },

    /** @param {string} prefix */
    users(prefix) {
      return q.users.all({ q: `${prefix.toLowerCase().replace(/[%_]/g, '')}%` });
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
