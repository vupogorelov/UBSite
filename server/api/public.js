// @ts-check
// The public layer: paragraph threads and translation proposals, shared by every signed-in user.
// Anyone writes messages and drafts (drafts are visible to their author only); translators publish
// and vote; coordinators (and admins) moderate.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';

const MAX_TEXT = 20_000;

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../translation.js').createTranslation>} tr
 * @param {ReturnType<typeof import('../notifications.js').createNotifications>} notifications
 * @param {ReturnType<typeof import('../glossary.js').createGlossary>} glossary
 * @param {ReturnType<typeof import('../chat.js').createChat>} chat
 */
export function registerPublicRoutes(router, db, tr, notifications, glossary, chat) {
  const PROPOSAL = `
    SELECT p.id, p.ref, p.start_pos AS start, p.end_pos AS "end", p.original, p.status, p.version,
           p.author_id AS authorId, coalesce(u.display_name, u.username) AS authorName,
           p.created_at AS createdAt, p.updated_at AS updatedAt, p.published_at AS publishedAt, p.closes_at AS closesAt,
           p.decided_at AS decidedAt, p.decision_note AS decisionNote, p.superseded_by AS supersededBy,
           v.text, v.note, pa.paper_id AS paperId, pp.title_ru AS paperTitle
    FROM proposals p
    JOIN proposal_versions v ON v.proposal_id = p.id AND v.version = p.version
    JOIN users u ON u.id = p.author_id
    LEFT JOIN paragraphs pa ON pa.ref = p.ref
    LEFT JOIN papers pp ON pp.id = pa.paper_id`;
  const VISIBLE = "(p.status != 'draft' OR p.author_id = :user)";
  const MESSAGE = `
    SELECT m.id, m.ref, m.proposal_id AS proposalId, m.kind, m.author_id AS authorId,
           coalesce(u.display_name, u.username) AS authorName, u.username AS authorUsername, m.ref AS chat, m.reply_to AS replyTo, m.body, m.hidden_at AS hiddenAt,
           m.created_at AS createdAt, m.updated_at AS updatedAt
    FROM public_messages m LEFT JOIN users u ON u.id = m.author_id`;
  const q = {
    byPaper: db.prepare(`${PROPOSAL} WHERE pa.paper_id = :paper AND ${VISIBLE} ORDER BY pa.seq, p.start_pos, p.id`),
    byRef: db.prepare(`${PROPOSAL} WHERE p.ref = :ref AND ${VISIBLE} ORDER BY p.start_pos, p.id`),
    one: db.prepare(`${PROPOSAL} WHERE p.id = :id AND ${VISIBLE}`),
    mine: db.prepare(`${PROPOSAL} WHERE p.author_id = :user ORDER BY p.updated_at DESC LIMIT 200`),
    voting: db.prepare(`${PROPOSAL} WHERE p.status = 'voting' ORDER BY p.closes_at LIMIT 200`),
    approved: db.prepare(`${PROPOSAL} WHERE p.status = 'approved' ORDER BY p.decided_at DESC LIMIT 200`),
    myVote: db.prepare('SELECT value FROM votes WHERE proposal_id = ? AND version = ? AND user_id = ?'),
    messageCounts: db.prepare(
      `SELECT m.ref, count(*) AS n FROM public_messages m JOIN paragraphs pa ON pa.ref = m.ref
       WHERE pa.paper_id = ? AND m.kind = 'message' AND m.hidden_at IS NULL GROUP BY m.ref`,
    ),
    proposalCounts: db.prepare(
      `SELECT p.ref, count(*) AS n FROM proposals p JOIN paragraphs pa ON pa.ref = p.ref
       WHERE pa.paper_id = ? AND p.status IN ('voting', 'approved') GROUP BY p.ref`,
    ),
    messages: db.prepare(`${MESSAGE} WHERE m.ref = ? ORDER BY m.id`),
    message: db.prepare('SELECT id, ref, author_id AS authorId, kind FROM public_messages WHERE id = ?'),
    editMessage: db.prepare("UPDATE public_messages SET body = ?, updated_at = datetime('now') WHERE id = ?"),
    deleteMessage: db.prepare('DELETE FROM public_messages WHERE id = ?'),
    hideMessage: db.prepare('UPDATE public_messages SET hidden_at = ?, hidden_by = ? WHERE id = ?'),
    paragraph: db.prepare('SELECT plain_ru FROM paragraphs WHERE ref = ?'),
    insert: db.prepare('INSERT INTO proposals (ref, start_pos, end_pos, original, author_id) VALUES (?, ?, ?, ?, ?) RETURNING id'),
    insertVersion: db.prepare('INSERT INTO proposal_versions (proposal_id, version, text, note) VALUES (?, ?, ?, ?)'),
    updateVersion: db.prepare('UPDATE proposal_versions SET text = ?, note = ? WHERE proposal_id = ? AND version = ?'),
    bumpVersion: db.prepare(
      `UPDATE proposals SET version = version + 1, closes_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`,
    ),
    touch: db.prepare("UPDATE proposals SET updated_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM proposals WHERE id = ?'),
    vote: db.prepare(
      `INSERT INTO votes (proposal_id, version, user_id, value) VALUES (?, ?, ?, ?)
       ON CONFLICT (proposal_id, version, user_id) DO UPDATE SET value = excluded.value, created_at = datetime('now')`,
    ),
    unvote: db.prepare('DELETE FROM votes WHERE proposal_id = ? AND version = ? AND user_id = ?'),
  };

  /** @param {import('../auth.js').User} user */
  const isCoordinator = (user) => user.isCoordinator || user.isAdmin;
  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
  /** @param {unknown} v @param {string} what */
  const text = (v, what) => {
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${what}: пусто`);
    if (v.length > MAX_TEXT) throw new HttpError(400, `${what}: длиннее ${MAX_TEXT} символов`);
    return v.trim();
  };
  /** @param {unknown} v */
  const note = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null);

  /** Adds the vote tally, the user's vote and what the user may do. @param {any} p @param {import('../auth.js').User} user */
  const present = (p, user) => {
    const cfg = tr.config();
    const mine = /** @type {{ value: number } | undefined} */ (q.myVote.get(p.id, p.version, user.id));
    const own = p.authorId === user.id;
    return {
      ...p,
      votes: { ...tr.tally(p.id, p.version), mine: mine?.value ?? null },
      // Glossary warnings matter while the variant can still change or be voted on.
      warnings: p.status === 'draft' || p.status === 'voting' ? glossary.check(p.original, p.text) : [],
      can: {
        edit: own && (p.status === 'draft' || p.status === 'voting'),
        publish: own && p.status === 'draft' && user.isTranslator,
        withdraw: own && p.status === 'voting',
        delete: own && p.status === 'draft',
        vote: p.status === 'voting' && user.isTranslator && (cfg.authorCanVote || !own),
        moderate: isCoordinator(user) && (p.status === 'voting' || p.status === 'approved'),
      },
    };
  };
  /** @param {number} id @param {import('../auth.js').User} user */
  const fetchOne = (id, user) => {
    const p = q.one.get({ id, user: user.id });
    if (!p) throw new HttpError(404, 'Предложение не найдено');
    return present(p, user);
  };
  /** @param {number} id @param {import('../auth.js').User} user */
  const ownProposal = (id, user) => {
    const p = tr.get(id);
    if (p.author_id !== user.id) throw new HttpError(403, 'Это предложение другого автора');
    return p;
  };

  router.on('GET', '/api/public/config', () => tr.config());

  // Marks and counters for the reader.
  router.on('GET', '/api/public/paper/:id', ({ params, user }) => {
    tr.sweep();
    const paper = Number(params.id);
    return {
      proposals: q.byPaper.all({ paper, user: user.id }).map((p) => present(p, user)),
      messages: Object.fromEntries(/** @type {{ ref: string, n: number }[]} */ (q.messageCounts.all(paper)).map((r) => [r.ref, r.n])),
    };
  });

  // A guest's marks (a shared link, not signed in): how many discussion messages and published
  // translation variants each paragraph has — the numbers only; reading them takes signing in.
  router.on('GET', '/api/guest/paper/:id', ({ params }) => {
    const paper = Number(params.id);
    /** @param {import('node:sqlite').StatementSync} st */
    const counts = (st) => Object.fromEntries(/** @type {{ ref: string, n: number }[]} */ (st.all(paper)).map((r) => [r.ref, r.n]));
    return { messages: counts(q.messageCounts), proposals: counts(q.proposalCounts) };
  });

  // Everything about one paragraph: proposals and the thread.
  router.on('GET', '/api/public/thread/:ref', ({ params, user }) => {
    tr.sweep();
    const messages = chat.present(/** @type {any[]} */ (q.messages.all(params.ref)), user);
    return {
      ref: params.ref,
      proposals: q.byRef.all({ ref: params.ref, user: user.id }).map((p) => present(p, user)),
      messages,
      following: notifications.following(user.id, params.ref),
    };
  });

  // { follow: boolean } — follow the thread without taking part, or mute it.
  router.on('POST', '/api/public/thread/:ref/follow', async ({ req, params, user }) => {
    if (!q.paragraph.get(params.ref)) throw new HttpError(404, `Абзац ${params.ref} не найден`);
    notifications.setFollow(user.id, params.ref, (await body(req)).follow === true);
    return { following: notifications.following(user.id, params.ref) };
  });

  // Lists for the translation tab: scope = queue | mine | voting | approved
  router.on('GET', '/api/public/proposals', ({ url, user }) => {
    tr.sweep();
    const scope = url.searchParams.get('scope');
    if (scope === 'queue') return notifications.queue(user).map((id) => fetchOne(id, user));
    const rows = scope === 'mine' ? q.mine.all({ user: user.id }) : scope === 'voting' ? q.voting.all() : q.approved.all();
    return rows.map((p) => present(p, user));
  });

  router.on('POST', '/api/public/thread/:ref/messages', async ({ req, params, user }) => {
    const b = await body(req);
    if (!q.paragraph.get(params.ref)) throw new HttpError(404, `Абзац ${params.ref} не найден`);
    let proposalId = null;
    if (b.proposalId !== undefined && b.proposalId !== null) {
      const p = tr.get(Number(b.proposalId));
      if (p.ref !== params.ref || (p.status === 'draft' && p.author_id !== user.id)) throw new HttpError(400, 'Предложение не из этого абзаца');
      proposalId = p.id;
    }
    return chat.post(params.ref, user, { body: text(b.body, 'Сообщение'), replyTo: b.replyTo, proposalId, writtenAt: b.writtenAt });
  });

  router.on('PATCH', '/api/public/messages/:mid', async ({ req, params, user }) => {
    const m = /** @type {any} */ (q.message.get(Number(params.mid)));
    if (!m || m.kind !== 'message') throw new HttpError(404, 'Сообщение не найдено');
    if (m.authorId !== user.id) throw new HttpError(403, 'Изменять можно только свои сообщения');
    q.editMessage.run(text((await body(req)).body, 'Сообщение'), m.id);
    return chat.edited(m.id, user);
  });

  router.on('DELETE', '/api/public/messages/:mid', ({ params, user }) => {
    const m = /** @type {any} */ (q.message.get(Number(params.mid)));
    if (!m || m.kind !== 'message') throw new HttpError(404, 'Сообщение не найдено');
    if (m.authorId !== user.id && !chat.ownsChat(m.ref, user)) throw new HttpError(403, 'Удалять можно только свои сообщения; координатор может скрыть');
    q.deleteMessage.run(m.id);
    chat.deleted(m.ref, m.id);
    return { ok: true };
  });

  router.on('POST', '/api/public/messages/:mid/hide', async ({ req, params, user }) => {
    if (!isCoordinator(user)) throw new HttpError(403, 'Скрывать сообщения могут координаторы');
    const m = /** @type {any} */ (q.message.get(Number(params.mid)));
    if (!m || chat.workspaceOf(m.ref) !== null) throw new HttpError(404, 'Сообщение не найдено'); // members-only chats: their owners
    const hide = (await body(req)).hidden !== false;
    q.hideMessage.run(hide ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, hide ? user.id : null, m.id);
    chat.changed(m.id);
    return { ok: true };
  });

  // New draft: { ref, start, end, text, note? } — offsets in the Russian text of the paragraph.
  router.on('POST', '/api/public/proposals', async ({ req, user }) => {
    const b = await body(req);
    const para = /** @type {{ plain_ru: string } | undefined} */ (q.paragraph.get(String(b.ref)));
    if (!para) throw new HttpError(400, `Абзац ${b.ref} не найден`);
    const start = Number(b.start);
    const end = Number(b.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > para.plain_ru.length) {
      throw new HttpError(400, 'Неверные границы фрагмента');
    }
    const original = para.plain_ru.slice(start, end);
    const t = text(b.text, 'Перевод');
    if (t === original) throw new HttpError(400, 'Вариант совпадает с исходным текстом');
    const id = transaction(db, () => {
      const row = /** @type {{ id: number }} */ (q.insert.get(String(b.ref), start, end, original, user.id));
      q.insertVersion.run(row.id, 1, t, note(b.note));
      return row.id;
    });
    return fetchOne(id, user);
  });

  // Edit: { text?, note? }. A draft is edited in place; a proposal under vote gets a new version
  // (earlier votes stay with the old version) and a fresh voting period.
  router.on('PATCH', '/api/public/proposals/:pid', async ({ req, params, user }) => {
    const p = ownProposal(Number(params.pid), user);
    const b = await body(req);
    const cur = /** @type {any} */ (q.one.get({ id: p.id, user: user.id }));
    const t = b.text === undefined ? cur.text : text(b.text, 'Перевод');
    const n = b.note === undefined ? cur.note : note(b.note);
    if (t === p.original) throw new HttpError(400, 'Вариант совпадает с исходным текстом');
    transaction(db, () => {
      if (p.status === 'draft') {
        q.updateVersion.run(t, n, p.id, p.version);
        q.touch.run(p.id);
      } else if (p.status === 'voting') {
        if (t === cur.text && n === cur.note) return;
        q.insertVersion.run(p.id, p.version + 1, t, n);
        q.bumpVersion.run(`+${tr.config().durationDays} days`, p.id);
        tr.event(p, user.id, `Новая версия ${p.version + 1}: голоса обнулены, срок голосования начат заново`);
      } else {
        throw new HttpError(400, 'Решённое предложение не меняется — создайте новое');
      }
    });
    return fetchOne(p.id, user);
  });

  router.on('DELETE', '/api/public/proposals/:pid', ({ params, user }) => {
    const p = ownProposal(Number(params.pid), user);
    if (p.status !== 'draft') throw new HttpError(400, 'Удалить можно только черновик');
    q.remove.run(p.id);
    return { id: p.id, deleted: true };
  });

  router.on('POST', '/api/public/proposals/:pid/publish', ({ params, user }) => {
    transaction(db, () => tr.publish(Number(params.pid), user));
    return fetchOne(Number(params.pid), user);
  });

  router.on('POST', '/api/public/proposals/:pid/withdraw', ({ params, user }) => {
    const p = ownProposal(Number(params.pid), user);
    transaction(db, () => tr.unpublish(p.id, user.id, 'Автор снял с голосования'));
    return fetchOne(p.id, user);
  });

  // { value: 1 | -1 | 0 | null } — null withdraws the vote
  router.on('POST', '/api/public/proposals/:pid/vote', async ({ req, params, user }) => {
    const p = tr.get(Number(params.pid));
    if (!user.isTranslator) throw new HttpError(403, 'Голосуют переводчики');
    if (p.status !== 'voting') throw new HttpError(400, 'Голосование по этому предложению закрыто');
    if (p.author_id === user.id && !tr.config().authorCanVote) throw new HttpError(403, 'Автор не голосует за своё предложение');
    const v = (await body(req)).value;
    if (v !== null && v !== 1 && v !== -1 && v !== 0) throw new HttpError(400, 'Голос: 1, -1, 0 или null');
    transaction(db, () => {
      if (v === null) q.unvote.run(p.id, p.version, user.id);
      else q.vote.run(p.id, p.version, user.id, v);
      tr.evaluate(p.id);
    });
    return fetchOne(p.id, user);
  });

  // Coordinator: { action: 'unpublish' | 'reject', note? }
  router.on('POST', '/api/public/proposals/:pid/moderate', async ({ req, params, user }) => {
    if (!isCoordinator(user)) throw new HttpError(403, 'Только для координаторов');
    const b = await body(req);
    const reason = note(b.note);
    const id = Number(params.pid);
    transaction(db, () => {
      if (b.action === 'unpublish') tr.unpublish(id, user.id, `Координатор снял с голосования${reason ? `: ${reason}` : ''}`);
      else if (b.action === 'reject') tr.reject(id, user.id, `Отклонено координатором${reason ? `: ${reason}` : ''}`);
      else throw new HttpError(400, 'action: unpublish или reject');
    });
    return q.one.get({ id, user: user.id }) ? fetchOne(id, user) : { id, hidden: true };
  });
}
