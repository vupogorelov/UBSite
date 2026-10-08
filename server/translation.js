// @ts-check
// Collective translation: proposals to improve a fragment of the Russian text, voting, decisions.
// Offsets are in paragraphs.plain_ru. Approved fragments of one paragraph never overlap: a
// proposal touching an approved fragment must cover it entirely and replaces it when approved.
import { HttpError } from './http.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/**
 * @typedef {{
 *   threshold: number,      // share of "for" among decisive votes (for + against), 0.5…1
 *   quorum: number,         // minimum decisive votes
 *   durationDays: number,   // voting period
 *   authorCanVote: boolean,
 *   decideEarly: boolean,   // approve as soon as the rule is met, not only when the period ends
 * }} VotingConfig
 * @typedef {{ for: number, against: number, abstain: number }} Tally
 */

/** @type {VotingConfig} */
export const DEFAULT_VOTING = { threshold: 0.8, quorum: 3, durationDays: 14, authorCanVote: false, decideEarly: true };

/** @param {Tally} t @param {VotingConfig} cfg */
export function outcome(t, cfg) {
  const decisive = t.for + t.against;
  const share = decisive ? t.for / decisive : 0;
  return { decisive, share, quorumMet: decisive >= cfg.quorum, passes: decisive >= cfg.quorum && share >= cfg.threshold - 1e-9 };
}

/** @param {unknown} input @returns {VotingConfig} */
export function sanitizeVoting(input) {
  const src = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const num = (/** @type {string} */ k, /** @type {number} */ min, /** @type {number} */ max, /** @type {number} */ def) => {
    const v = Number(src[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : def;
  };
  return {
    threshold: num('threshold', 0.5, 1, DEFAULT_VOTING.threshold),
    quorum: Math.round(num('quorum', 1, 100, DEFAULT_VOTING.quorum)),
    durationDays: Math.round(num('durationDays', 1, 365, DEFAULT_VOTING.durationDays)),
    authorCanVote: typeof src.authorCanVote === 'boolean' ? src.authorCanVote : DEFAULT_VOTING.authorCanVote,
    decideEarly: typeof src.decideEarly === 'boolean' ? src.decideEarly : DEFAULT_VOTING.decideEarly,
  };
}

const pct = (/** @type {number} */ x) => `${Math.round(x * 100)}%`;

/** @param {DatabaseSync} db */
export function createTranslation(db) {
  const q = {
    getMeta: db.prepare("SELECT value FROM meta WHERE key = 'voting'"),
    setMeta: db.prepare("INSERT INTO meta (key, value) VALUES ('voting', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
    proposal: db.prepare('SELECT * FROM proposals WHERE id = ?'),
    tally: db.prepare(
      `SELECT coalesce(sum(value = 1), 0) AS "for", coalesce(sum(value = -1), 0) AS against, coalesce(sum(value = 0), 0) AS abstain
       FROM votes WHERE proposal_id = ? AND version = ?`,
    ),
    approvedInRef: db.prepare("SELECT id, start_pos, end_pos FROM proposals WHERE ref = ? AND status = 'approved' AND id != ?"),
    votingInRef: db.prepare("SELECT * FROM proposals WHERE ref = ? AND status = 'voting' AND id != ?"),
    setStatus: db.prepare(
      `UPDATE proposals SET status = :status, decided_at = datetime('now'), decision_note = :note, updated_at = datetime('now')
       WHERE id = :id`,
    ),
    supersede: db.prepare(
      "UPDATE proposals SET status = 'superseded', superseded_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ),
    backToDraft: db.prepare(
      `UPDATE proposals SET status = 'draft', published_at = NULL, closes_at = NULL, decision_note = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ),
    publish: db.prepare(
      `UPDATE proposals SET status = 'voting', published_at = datetime('now'), closes_at = datetime('now', ?),
              decided_at = NULL, decision_note = NULL, updated_at = datetime('now') WHERE id = ?`,
    ),
    expired: db.prepare("SELECT id FROM proposals WHERE status = 'voting' AND closes_at <= datetime('now')"),
    event: db.prepare("INSERT INTO public_messages (ref, proposal_id, kind, author_id, body) VALUES (?, ?, 'event', ?, ?)"),
  };

  /** @returns {VotingConfig} */
  function config() {
    const row = /** @type {{ value: string } | undefined} */ (q.getMeta.get());
    return sanitizeVoting({ ...DEFAULT_VOTING, ...JSON.parse(row?.value ?? '{}') });
  }

  /** @param {number} id @returns {any} */
  function get(id) {
    const p = q.proposal.get(id);
    if (!p) throw new HttpError(404, 'Предложение не найдено');
    return p;
  }

  /** @param {number} id @param {number} version @returns {Tally} */
  const tally = (id, version) => /** @type {Tally} */ ({ ...q.tally.get(id, version) });

  /** @param {any} p @param {number | null} actorId @param {string} body */
  const event = (p, actorId, body) => q.event.run(p.ref, p.id, actorId, body);

  /** `p` touches the approved fragment `a` without covering it entirely. @param {any} p @param {any} a */
  const touchesPartly = (p, a) =>
    a.start_pos < p.end_pos && p.start_pos < a.end_pos && !(p.start_pos <= a.start_pos && a.end_pos <= p.end_pos);

  const CONFLICT_NOTE = 'Фрагмент частично задевает принятый перевод: расширьте выделение так, чтобы оно накрывало его целиком';

  /** A proposal under vote that conflicts with an approved fragment goes back to its author. @param {any} p */
  function returnConflicting(p) {
    q.backToDraft.run(CONFLICT_NOTE, p.id);
    event(p, null, `Вернулось в черновики автора: пересекается с принятым переводом — расширьте выделение, чтобы накрыть его целиком`);
  }

  /**
   * Approves and replaces the approved fragments it covers; proposals under vote that now touch
   * the new approved fragment only partly go back to drafts.
   * @param {any} p @param {Tally} t @param {string} note
   */
  function approve(p, t, note) {
    for (const a of /** @type {any[]} */ (q.approvedInRef.all(p.ref, p.id))) {
      if (a.start_pos < p.end_pos && p.start_pos < a.end_pos) q.supersede.run(p.id, a.id);
    }
    q.setStatus.run({ status: 'approved', note, id: p.id });
    event(p, null, `Принято: ${t.for} за, ${t.against} против${t.abstain ? `, ${t.abstain} воздержались` : ''}`);
    for (const o of /** @type {any[]} */ (q.votingInRef.all(p.ref, p.id))) {
      if (touchesPartly(o, p)) returnConflicting(o);
    }
  }

  return {
    config,

    /** @param {unknown} patch */
    setConfig(patch) {
      const cfg = sanitizeVoting({ ...config(), .../** @type {object} */ (patch ?? {}) });
      q.setMeta.run(JSON.stringify(cfg));
      return cfg;
    },

    tally,
    get,

    /** Decides a proposal under vote if its rule is met (or its period is over). @param {number} id */
    evaluate(id) {
      const p = get(id);
      if (p.status !== 'voting') return p.status;
      // Safety net for data from before the rule: never approve over a partly covered fragment.
      if ((/** @type {any[]} */ (q.approvedInRef.all(p.ref, p.id))).some((a) => touchesPartly(p, a))) {
        returnConflicting(p);
        return 'draft';
      }
      const cfg = config();
      const t = tally(p.id, p.version);
      const o = outcome(t, cfg);
      const over = Date.parse(p.closes_at.replace(' ', 'T') + 'Z') <= Date.now();
      if (o.passes && (cfg.decideEarly || over)) {
        approve(p, t, `${pct(o.share)} за при кворуме ${cfg.quorum}`);
        return 'approved';
      }
      if (!over) return 'voting';
      if (o.quorumMet) {
        q.setStatus.run({ status: 'rejected', note: `Набрано ${pct(o.share)} за, нужно ${pct(cfg.threshold)}`, id: p.id });
        event(p, null, `Отклонено: ${t.for} за, ${t.against} против — меньше ${pct(cfg.threshold)}`);
        return 'rejected';
      }
      q.backToDraft.run(`Срок голосования истёк без кворума (${o.decisive} из ${cfg.quorum})`, p.id);
      event(p, null, `Срок истёк без кворума (${o.decisive} из ${cfg.quorum}) — предложение вернулось в черновики автора`);
      return 'draft';
    },

    /** Decides everything whose voting period has ended. */
    sweep() {
      for (const { id } of /** @type {{ id: number }[]} */ (q.expired.all())) this.evaluate(id);
    },

    /** @param {number} id @param {import('./auth.js').User} user */
    publish(id, user) {
      const p = get(id);
      if (p.author_id !== user.id) throw new HttpError(403, 'Опубликовать может только автор');
      if (!user.isTranslator) throw new HttpError(403, 'Публиковать на голосование могут переводчики');
      if (p.status !== 'draft') throw new HttpError(400, 'Опубликовать можно только черновик');
      for (const a of /** @type {any[]} */ (q.approvedInRef.all(p.ref, p.id))) {
        if (touchesPartly(p, a)) throw new HttpError(409, CONFLICT_NOTE);
      }
      q.publish.run(`+${config().durationDays} days`, p.id);
      event(p, user.id, p.version > 1 ? `Опубликовано на голосование (версия ${p.version})` : 'Опубликовано на голосование');
      return this.evaluate(p.id);
    },

    /** Author takes a proposal back, or a coordinator removes it from voting. @param {number} id @param {number} actorId @param {string} note */
    unpublish(id, actorId, note) {
      const p = get(id);
      if (p.status !== 'voting') throw new HttpError(400, 'Предложение не на голосовании');
      q.backToDraft.run(note, p.id);
      event(p, actorId, note);
    },

    /** Coordinator decisions. @param {number} id @param {number} actorId @param {string} note */
    reject(id, actorId, note) {
      const p = get(id);
      if (p.status !== 'voting' && p.status !== 'approved') throw new HttpError(400, 'Отклонить можно предложение на голосовании или принятое');
      q.setStatus.run({ status: 'rejected', note, id: p.id });
      event(p, actorId, note);
    },

    event,
  };
}
