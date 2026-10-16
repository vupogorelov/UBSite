// @ts-check
// A change done once, however many times it is sent. The device's outgoing queue
// (web/src/lib/outbox.svelte.js) gives every change its own id (header X-Op-Id) and sends it again if
// the network broke — perhaps after the change was made but before its answer arrived. The answer is
// kept under that id: a repeat gets the same answer, and nothing is done twice (no second message,
// no second note). For every kind of change, in one place (server/main.js).

const KEEP_DAYS = 30;

/** @typedef {{ status: number, data: unknown }} Answer */

/** @param {import('node:sqlite').DatabaseSync} db */
export function createOps(db) {
  const q = {
    get: db.prepare('SELECT status, body FROM ops WHERE user_id = ? AND op_id = ?'),
    put: db.prepare('INSERT OR IGNORE INTO ops (user_id, op_id, status, body) VALUES (?, ?, ?, ?)'),
    purge: db.prepare(`DELETE FROM ops WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`),
  };
  /** Changes being done now: the same id arriving again meanwhile waits for the same answer. @type {Map<string, Promise<Answer>>} */
  const running = new Map();
  let purgedAt = 0;

  return {
    /**
     * Does the change once. `fn` answers { status, data, keep } — `keep`: the answer is final (done, or
     * refused for good); a failure that may pass (the server's own error) is not kept, so a repeat tries again.
     * @param {number} userId @param {string} opId @param {() => Promise<Answer & { keep: boolean }>} fn
     * @returns {Promise<Answer>}
     */
    async once(userId, opId, fn) {
      if (Date.now() - purgedAt > 3600_000) {
        purgedAt = Date.now();
        q.purge.run();
      }
      const row = /** @type {{ status: number, body: string } | undefined} */ (q.get.get(userId, opId));
      if (row) return { status: row.status, data: JSON.parse(row.body) };
      const key = `${userId}:${opId}`;
      let p = running.get(key);
      if (!p) {
        p = fn()
          .then((r) => {
            if (r.keep) q.put.run(userId, opId, r.status, JSON.stringify(r.data ?? null));
            return { status: r.status, data: r.data };
          })
          .finally(() => running.delete(key));
        running.set(key, p);
      }
      return p;
    },
  };
}

/** An id the device may give a change. @param {unknown} id @returns {id is string} */
export const validOpId = (id) => typeof id === 'string' && /^[\w-]{8,64}$/.test(id);
