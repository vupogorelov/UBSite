// @ts-check
// The journal of people's devices (web/src/lib/log.js): what happened there before a failure — the
// screens, the buttons pressed, the server's slow or failed answers, the reading aloud, the network, the
// app's own failures (android/). Sent in batches; read by administrators, a person's sessions in order.

import { HttpError } from './http.js';
import { transaction } from './db.js';

const KEEP_DAYS = 30;
const MAX_BATCH = 300;
const LEVELS = new Set(['info', 'warn', 'error']);

/** @typedef {{ at: string, level: string, kind: string, name: string, data?: unknown }} ClientEvent */

/** @param {unknown} v @param {number} max */
const str = (v, max) => String(v ?? '').slice(0, max);
/** An ISO time from the device → SQLite's ("2026-10-15 12:01:02.345"), or now. @param {unknown} v */
function time(v) {
  const t = Date.parse(String(v));
  const d = Number.isFinite(t) && Math.abs(t - Date.now()) < 40 * 86400_000 ? new Date(t) : new Date();
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createClientLog(db) {
  const q = {
    insert: db.prepare('INSERT INTO client_events (user_id, session, device, at, level, kind, name, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    purge: db.prepare(`DELETE FROM client_events WHERE at < datetime('now', '-${KEEP_DAYS} days')`),
    // sessions: newest first; with their failures counted
    sessions: db.prepare(`
      SELECT e.session, e.user_id AS userId, coalesce(u.display_name, u.username) AS userName, max(e.device) AS device,
             min(e.at) AS fromAt, max(e.at) AS toAt, count(*) AS events, sum(e.level = 'error') AS errors, sum(e.level = 'warn') AS warnings
      FROM client_events e JOIN users u ON u.id = e.user_id
      WHERE (:user IS NULL OR e.user_id = :user)
      GROUP BY e.session HAVING (:failed = 0 OR sum(e.level = 'error') > 0) AND (:before IS NULL OR max(e.at) < :before)
      ORDER BY max(e.at) DESC LIMIT :limit`),
    events: db.prepare('SELECT at, level, kind, name, data FROM client_events WHERE session = ? ORDER BY at, id'),
    people: db.prepare(`
      SELECT u.id, coalesce(u.display_name, u.username) AS name, count(*) AS events, sum(e.level = 'error') AS errors, max(e.at) AS lastAt
      FROM client_events e JOIN users u ON u.id = e.user_id GROUP BY u.id ORDER BY max(e.at) DESC`),
  };
  let purgedAt = 0;

  return {
    /**
     * A batch from a device. @param {number} userId
     * @param {{ session?: unknown, device?: unknown, events?: unknown }} batch @returns {number} how many were kept
     */
    add(userId, batch) {
      if (!Array.isArray(batch.events)) throw new HttpError(400, 'events: массив');
      if (batch.events.length > MAX_BATCH) throw new HttpError(400, `Не больше ${MAX_BATCH} событий за раз`);
      const session = str(batch.session, 64);
      const device = str(batch.device, 120);
      if (!session) throw new HttpError(400, 'session: нужен');
      if (Date.now() - purgedAt > 3600_000) {
        purgedAt = Date.now();
        q.purge.run();
      }
      return transaction(db, () => {
        let n = 0;
        for (const e of /** @type {any[]} */ (batch.events)) {
          if (!e || typeof e !== 'object') continue;
          const level = LEVELS.has(e.level) ? e.level : 'info';
          const data = e.data === undefined || e.data === null ? null : str(typeof e.data === 'string' ? e.data : JSON.stringify(e.data), 4000);
          q.insert.run(userId, session, device, time(e.at), level, str(e.kind, 32) || 'other', str(e.name, 160), data);
          n++;
        }
        return n;
      });
    },

    /**
     * Sessions (newest first) with their events, for the administrator's journal.
     * @param {{ user?: number | null, failed?: boolean, before?: string | null, limit?: number }} f
     */
    list(f) {
      const rows = /** @type {any[]} */ (q.sessions.all({ user: f.user ?? null, failed: f.failed ? 1 : 0, before: f.before ?? null, limit: Math.min(50, f.limit ?? 20) }));
      return {
        people: q.people.all(),
        sessions: rows.map((s) => ({
          ...s,
          events: /** @type {any[]} */ (q.events.all(s.session)).map((e) => ({ ...e, data: e.data === null ? null : safeParse(e.data) })),
        })),
      };
    },
  };
}

/** @param {string} s */
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
