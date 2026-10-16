// @ts-check
// Changes of notes and tasks told to the open tabs at once, instead of each tab asking every minute.
// Every change is already written down by the database's triggers (the `changes` table, migrations 34–35:
// a workspace's notes, a person's tasks), whoever made it — so the server only looks there: every second,
// a read of the rows after the last seen one (by the primary key; nothing new — next to nothing to do).
// Each open tab whose person is concerned is told "changed" over the live stream (chat's hub); the tab
// fetches what changed by its feed (web/src/lib/feed.js), as before. Nothing of the content goes this way.

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ tell: (pick: (userId: number) => Record<string, unknown> | null) => void }} hub
 * @param {{ role: (workspaceId: number, userId: number) => unknown }} auth
 */
export function createLive(db, hub, auth) {
  const q = {
    last: db.prepare('SELECT coalesce(max(seq), 0) AS seq FROM changes'),
    after: db.prepare('SELECT seq, workspace_id AS ws, user_id AS user FROM changes WHERE seq > ? ORDER BY seq LIMIT 5000'),
  };
  let seen = /** @type {{ seq: number }} */ (q.last.get()).seq;

  /** Tells the tabs what changed since the last look. @returns {number} how many changes */
  function tick() {
    const rows = /** @type {{ seq: number, ws: number, user: number | null }[]} */ (q.after.all(seen));
    if (!rows.length) return 0;
    seen = rows[rows.length - 1].seq;
    /** @type {Set<number>} */ const workspaces = new Set();
    /** @type {Set<number>} */ const owners = new Set();
    for (const r of rows) {
      if (r.user !== null) owners.add(r.user); // a task: its owner's alone
      else workspaces.add(r.ws); // a note: its workspace's members
    }
    hub.tell((uid) => {
      const notes = [...workspaces].filter((ws) => auth.role(ws, uid));
      const tasks = owners.has(uid);
      return notes.length || tasks ? { type: 'changed', notes, tasks } : null;
    });
    return rows.length;
  }

  return {
    tick,
    /** Looks every `ms`; returns the stop. @param {number} [ms] */
    start(ms = 1000) {
      const timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Live changes failed:', err);
        }
      }, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
