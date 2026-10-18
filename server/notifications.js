// @ts-check
// In-app notifications, built from the paragraph threads themselves: every message and every
// event of the public layer (published, approved, rejected, back to drafts…) is a row of
// public_messages, so a notification is such a row in a thread the user follows.
// A user follows a thread from the moment they take part in it (a message, a proposal, a vote) or
// press "Следить"; "Не следить" mutes it. What was posted before following is not news.

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */

const LIMIT = 50;

/**
 * Threads the user follows, with the moment from which their news count. Needs :user.
 * A note's conversation ("note:7") is followed by the note's author and by those who wrote in it.
 */
const FOLLOWED = `
  taken(ref, since) AS (
    SELECT ref, created_at FROM public_messages WHERE author_id = :user AND kind = 'message'
    UNION ALL SELECT 'note:' || id, created_at FROM annotations WHERE author_id = :user
    UNION ALL SELECT ref, created_at FROM proposals WHERE author_id = :user
    UNION ALL SELECT p.ref, v.created_at FROM votes v JOIN proposals p ON p.id = v.proposal_id WHERE v.user_id = :user
    UNION ALL SELECT ref, created_at FROM thread_follows WHERE user_id = :user AND follow = 1
  ),
  followed(ref, since) AS (
    SELECT ref, min(since) FROM taken
    WHERE ref NOT IN (SELECT ref FROM thread_follows WHERE user_id = :user AND follow = 0)
    GROUP BY ref
  )`;
/**
 * News for the user: others' messages and events in followed paragraph threads and note
 * conversations, and messages anywhere that @mention the user (channels and workspace chats have
 * their own unread counters). Members-only conversations count only while the user is a member.
 */
const NEWS = `
  FROM public_messages m LEFT JOIN followed f ON f.ref = m.ref
  WHERE ((f.ref IS NOT NULL AND m.created_at >= f.since AND m.ref NOT LIKE 'chan:%' AND m.ref NOT LIKE 'ws:%' AND m.ref NOT LIKE 'dm:%')
         OR m.id IN (SELECT message_id FROM mentions WHERE user_id = :user))
    AND (m.author_id IS NULL OR m.author_id != :user) AND m.hidden_at IS NULL
    AND (m.ref NOT LIKE 'note:%' OR EXISTS (SELECT 1 FROM annotations a JOIN workspace_members wm
           ON wm.workspace_id = a.workspace_id AND wm.user_id = :user WHERE m.ref = 'note:' || a.id))
    AND (m.ref NOT LIKE 'ws:%' OR EXISTS (SELECT 1 FROM workspace_members wm
           WHERE wm.user_id = :user AND m.ref = 'ws:' || wm.workspace_id))`;
/**
 * Not new any more: seen in the bell (everything up to :seen), or read in its chat — the chat's read mark
 * is past it (a reply read where it was written does not stay new in the bell).
 */
const NEW = `(m.id > :seen AND NOT EXISTS (SELECT 1 FROM chat_reads cr WHERE cr.user_id = :user AND cr.chat = m.ref AND cr.last_read_id >= m.id))`;

/**
 * @param {DatabaseSync} db
 * @param {ReturnType<typeof import('./translation.js').createTranslation>} tr
 */
export function createNotifications(db, tr) {
  const q = {
    list: db.prepare(`
      WITH ${FOLLOWED}
      SELECT m.id, m.ref, m.kind, m.body, m.created_at AS createdAt, m.proposal_id AS proposalId,
             coalesce(u.display_name, u.username) AS authorName, pp.title_ru AS paperTitle,
             p.original, v.text, ${NEW} AS unread,
             EXISTS (SELECT 1 FROM mentions WHERE message_id = m.id AND user_id = :user) AS mention,
             CASE WHEN m.ref LIKE 'chan:%' THEN (SELECT '# ' || title FROM channels WHERE id = CAST(substr(m.ref, 6) AS INTEGER))
                  WHEN m.ref LIKE 'ws:%' THEN (SELECT name FROM workspaces WHERE id = CAST(substr(m.ref, 4) AS INTEGER))
                  WHEN m.ref LIKE 'note:%' THEN (SELECT 'Заметка · ' || a.ref FROM annotations a WHERE a.id = CAST(substr(m.ref, 6) AS INTEGER))
                  WHEN m.ref LIKE 'dict:%' THEN (SELECT 'Словарь · ' || d.name_ru FROM dict_articles d WHERE d.id = CAST(substr(m.ref, 6) AS INTEGER)) END AS chatTitle,
             na.ref AS noteRef, na.workspace_id AS noteWorkspace, nw.name AS noteWorkspaceName, nw.kind AS noteWorkspaceKind,
             mm.id AS markedId, mm.body AS markedBody
      ${NEWS.replace('FROM public_messages m', `FROM public_messages m
        LEFT JOIN users u ON u.id = m.author_id
        LEFT JOIN proposals p ON p.id = m.proposal_id
        LEFT JOIN proposal_versions v ON v.proposal_id = p.id AND v.version = p.version
        LEFT JOIN annotations na ON m.ref LIKE 'note:%' AND na.id = CAST(substr(m.ref, 6) AS INTEGER)
        LEFT JOIN workspaces nw ON nw.id = na.workspace_id
        LEFT JOIN public_messages mm ON m.ref LIKE 'mark:%' AND mm.id = m.reply_to
        LEFT JOIN paragraphs pa ON pa.ref = coalesce(na.ref, m.ref)
        LEFT JOIN papers pp ON pp.id = pa.paper_id`)}
      ORDER BY m.id DESC LIMIT ${LIMIT}`),
    unread: db.prepare(`WITH ${FOLLOWED} SELECT count(*) AS n ${NEWS} AND ${NEW}`),
    lastNews: db.prepare(`WITH ${FOLLOWED} SELECT coalesce(max(m.id), 0) AS id ${NEWS}`),
    seen: db.prepare('SELECT notif_seen_id AS seen FROM users WHERE id = ?'),
    setSeen: db.prepare('UPDATE users SET notif_seen_id = max(notif_seen_id, ?) WHERE id = ?'),
    queue: db.prepare(`
      SELECT p.id FROM proposals p
      WHERE p.status = 'voting' AND (:authorCanVote OR p.author_id != :user)
        AND NOT EXISTS (SELECT 1 FROM votes WHERE proposal_id = p.id AND version = p.version AND user_id = :user)
      ORDER BY p.closes_at`),
    explicit: db.prepare('SELECT follow FROM thread_follows WHERE user_id = ? AND ref = ?'),
    takesPart: db.prepare(`
      SELECT EXISTS (SELECT 1 FROM public_messages WHERE author_id = :user AND ref = :ref AND kind = 'message')
          OR EXISTS (SELECT 1 FROM proposals WHERE author_id = :user AND ref = :ref)
          OR EXISTS (SELECT 1 FROM votes v JOIN proposals p ON p.id = v.proposal_id WHERE v.user_id = :user AND p.ref = :ref)
          AS yes`),
    setFollow: db.prepare(
      `INSERT INTO thread_follows (user_id, ref, follow) VALUES (?, ?, ?)
       ON CONFLICT (user_id, ref) DO UPDATE SET follow = excluded.follow, created_at = datetime('now')`,
    ),
    unmute: db.prepare('DELETE FROM thread_follows WHERE user_id = ? AND ref = ? AND follow = 0'),
  };

  /** @param {number} userId */
  const seenId = (userId) => /** @type {{ seen: number }} */ (q.seen.get(userId)).seen;

  /** Proposals under vote still waiting for this translator's vote, the nearest deadline first. @param {import('./auth.js').User} user */
  function queue(user) {
    if (!user.isTranslator) return [];
    return /** @type {{ id: number }[]} */ (q.queue.all({ user: user.id, authorCanVote: tr.config().authorCanVote ? 1 : 0 })).map((r) => r.id);
  }

  return {
    queue,

    /** @param {import('./auth.js').User} user */
    counts(user) {
      const n = /** @type {{ n: number }} */ (q.unread.get({ user: user.id, seen: seenId(user.id) })).n;
      return { unread: n, queue: queue(user).length };
    },

    /** The latest news, newest first. @param {import('./auth.js').User} user */
    list(user) {
      return /** @type {any[]} */ (q.list.all({ user: user.id, seen: seenId(user.id) })).map((r) => ({ ...r, unread: !!r.unread, mention: !!r.mention }));
    },

    /** Everything up to the newest item is read. @param {import('./auth.js').User} user */
    markSeen(user) {
      const { id } = /** @type {{ id: number }} */ (q.lastNews.get({ user: user.id }));
      q.setSeen.run(id, user.id);
    },

    /** @param {number} userId @param {string} ref */
    following(userId, ref) {
      const row = /** @type {{ follow: number } | undefined} */ (q.explicit.get(userId, ref));
      if (row) return row.follow === 1;
      return !!(/** @type {{ yes: number }} */ (q.takesPart.get({ user: userId, ref })).yes);
    },

    /** Follows or mutes a thread. @param {number} userId @param {string} ref @param {boolean} follow */
    setFollow(userId, ref, follow) {
      q.setFollow.run(userId, ref, follow ? 1 : 0);
    },

    /** Writing in a muted thread follows it again (as on GitHub). @param {number} userId @param {string} ref */
    unmute(userId, ref) {
      q.unmute.run(userId, ref);
    },
  };
}
