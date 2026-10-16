// @ts-check
// Analytics for administrators: how people use the app. Collected as one row per person per active
// minute (activity_minutes: the section, reading, listening); counted from it and from what people made
// (messages, tasks, the support channel's marks). No content is collected — only time and places.
//
// A session is a run of active minutes with gaps under 30 minutes (the common web-analytics rule); its
// length is from its first minute to its last, plus one. Reading — the book on screen with the person
// active; listening — the voice reading. Averages per week / month / … — sessions divided by the number
// of such periods since the person's first active minute in the range.
import { HttpError } from './http.js';

/** The sections a minute can be in (anything else is "other"). */
export const SECTIONS = ['book', 'search', 'notes', 'collections', 'tags', 'translate', 'chat', 'tasks', 'collection', 'about', 'support', 'other'];
/** What the app is opened on: a phone or tablet / a computer, the installed app / a browser. */
// phone-native — the Android app (android/); *-app — the site installed (PWA); *-browser — a browser tab
export const DEVICES = ['phone-native', 'phone-app', 'phone-browser', 'computer-app', 'computer-browser'];
/** The device's system (for the phones' pie: Android or iOS). */
export const SYSTEMS = ['android', 'ios', 'other'];
/** Days are counted in Moscow time (UTC+3, no summer time), as the Book's voice. */
const DAY_OFFSET = 180;
/** A break this long ends a session (minutes). */
const GAP = 30;
const PERIODS = { week: 7, month: 30.44, quarter: 91.31, half: 182.62, year: 365.25 };

/**
 * One person's minutes → sessions and totals.
 * @param {{ minute: number, section: string, reading: number, listening: number, device?: string, os?: string }[]} rows sorted by minute
 */
export function summarize(rows) {
  /** @type {{ start: number, end: number, reading: number, listening: number }[]} */
  const sessions = [];
  /** @type {Record<string, number>} */
  const sections = {};
  /** Minutes by what the app was opened on (minutes from before it was recorded are left out). @type {Record<string, number>} */
  const devices = {};
  /** The phones' minutes by their system (recorded from 16 October 2026). @type {Record<string, number>} */
  const phones = {};
  let reading = 0, listening = 0;
  for (const r of rows) {
    const last = sessions.at(-1);
    if (!last || r.minute - last.end > GAP) sessions.push({ start: r.minute, end: r.minute, reading: 0, listening: 0 });
    const s = /** @type {typeof sessions[number]} */ (sessions.at(-1));
    s.end = r.minute;
    s.reading += r.reading;
    s.listening += r.listening;
    reading += r.reading;
    listening += r.listening;
    sections[r.section] = (sections[r.section] ?? 0) + 1;
    if (r.device) devices[r.device] = (devices[r.device] ?? 0) + 1;
    if (r.os && r.device?.startsWith('phone')) phones[r.os] = (phones[r.os] ?? 0) + 1;
  }
  const lengths = sessions.map((s) => s.end - s.start + 1);
  const total = lengths.reduce((a, b) => a + b, 0);
  const n = sessions.length;
  const first = rows[0]?.minute ?? null;
  const last = rows.at(-1)?.minute ?? null;
  // sessions per period: over the days from the first active minute to the last (at least one period)
  const days = first === null || last === null ? 0 : (last - first) / 1440 + 1;
  /** @type {Record<string, number>} */
  const perPeriod = {};
  for (const [name, len] of Object.entries(PERIODS)) perPeriod[name] = n ? n / Math.max(1, days / len) : 0;
  return {
    sessions: n,
    activeMinutes: rows.length,
    sessionMinutes: total,
    shortest: n ? Math.min(...lengths) : 0,
    longest: n ? Math.max(...lengths) : 0,
    average: n ? total / n : 0,
    lastSessionMinutes: n ? lengths[n - 1] : 0,
    reading,
    readingPerSession: n ? reading / n : 0,
    listening,
    listeningPerSession: n ? listening / n : 0,
    sections,
    devices,
    phones,
    perPeriod,
    firstSeen: first === null ? null : new Date(first * 60_000).toISOString(),
    lastSeen: last === null ? null : new Date(last * 60_000).toISOString(),
  };
}

/**
 * Everyone's minutes → a row per day of the period (days without anyone too): how many people were in
 * the app, the minutes of reading and of listening. `from`, `to` — minutes.
 * @param {{ userId: number, minute: number, reading: number, listening: number }[]} rows @param {number} from @param {number} to
 */
export function daily(rows, from, to) {
  const dayOf = (/** @type {number} */ m) => Math.floor((m + DAY_OFFSET) / 1440);
  /** @type {Map<number, { people: Set<number>, reading: number, listening: number }>} */
  const days = new Map();
  for (const r of rows) {
    const d = dayOf(r.minute);
    let x = days.get(d);
    if (!x) days.set(d, (x = { people: new Set(), reading: 0, listening: 0 }));
    x.people.add(r.userId);
    x.reading += r.reading;
    x.listening += r.listening;
  }
  const out = [];
  for (let d = dayOf(from); d <= dayOf(to); d++) {
    const x = days.get(d);
    out.push({ day: new Date(d * 86_400_000).toISOString().slice(0, 10), people: x?.people.size ?? 0, reading: x?.reading ?? 0, listening: x?.listening ?? 0 });
  }
  return out;
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createAnalytics(db) {
  const q = {
    beat: db.prepare(`
      INSERT INTO activity_minutes (user_id, minute, section, reading, listening, device, os) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, minute) DO UPDATE SET
        section = excluded.section, reading = max(reading, excluded.reading), listening = max(listening, excluded.listening),
        device = excluded.device, os = excluded.os`),
    minutes: db.prepare('SELECT user_id AS userId, minute, section, reading, listening, device, os FROM activity_minutes WHERE minute >= ? ORDER BY user_id, minute'),
    users: db.prepare(`SELECT id, username, coalesce(display_name, username) AS name, disabled, created_at AS createdAt
      FROM users WHERE is_agent = 0 ORDER BY id`),
    messages: db.prepare(`SELECT author_id AS userId, count(*) AS n FROM public_messages
      WHERE kind = 'message' AND ref NOT LIKE 'dm:%' AND created_at >= ? GROUP BY author_id`),
    asked: db.prepare(`SELECT author_id AS userId, count(*) AS n FROM public_messages
      WHERE kind = 'message' AND ref LIKE 'dm:%' AND created_at >= ? GROUP BY author_id`),
    tasks: db.prepare('SELECT user_id AS userId, count(*) AS n FROM tasks WHERE created_at >= ? GROUP BY user_id'),
    support: db.prepare(`SELECT m.author_id AS userId, sum(m.mark IN ('take', 'work', 'done')) AS taken, sum(m.mark = 'done') AS done
      FROM public_messages m JOIN channels c ON m.ref = 'chan:' || c.id
      WHERE c.title = 'Техподдержка' AND m.kind = 'message' AND m.created_at >= ? GROUP BY m.author_id`),
  };

  return {
    /**
     * A minute of a person's activity (the app sends it once a minute while they are active).
     * @param {number} userId @param {{ section?: unknown, reading?: unknown, listening?: unknown, device?: unknown, os?: unknown }} b @param {number} [now]
     */
    beat(userId, b, now = Date.now()) {
      const section = typeof b.section === 'string' && SECTIONS.includes(b.section) ? b.section : 'other';
      const device = typeof b.device === 'string' && DEVICES.includes(b.device) ? b.device : '';
      const os = typeof b.os === 'string' && SYSTEMS.includes(b.os) ? b.os : '';
      q.beat.run(userId, Math.floor(now / 60_000), section, b.reading === true ? 1 : 0, b.listening === true ? 1 : 0, device, os);
    },

    /**
     * The report for a period: per person and in sum. `days`: 7, 30, 90, … or 0 — all time.
     * @param {number} days @param {number} [now]
     */
    report(days, now = Date.now()) {
      if (!Number.isInteger(days) || days < 0 || days > 3660) throw new HttpError(400, 'Период: число дней');
      const since = days ? Math.floor(now / 60_000) - days * 1440 : 0;
      const sinceSql = days ? new Date(since * 60_000).toISOString().slice(0, 19).replace('T', ' ') : '0000';
      const rows = /** @type {any[]} */ (q.minutes.all(since));
      const byUser = Map.groupBy(rows, (r) => r.userId);
      const nowMinute = Math.floor(now / 60_000);
      // by day: from the period's first day with anyone in the app (days before it would be empty bars)
      const firstMinute = rows.reduce((m, r) => Math.min(m, r.minute), nowMinute);
      const byDay = daily(rows, firstMinute, nowMinute);
      const count = (/** @type {import('node:sqlite').StatementSync} */ st) =>
        new Map(/** @type {any[]} */ (st.all(sinceSql)).map((r) => [r.userId, r]));
      const messages = count(q.messages);
      const asked = count(q.asked);
      const tasks = count(q.tasks);
      const support = count(q.support);
      const people = /** @type {any[]} */ (q.users.all()).map((u) => ({
        id: u.id, username: u.username, name: u.name, disabled: !!u.disabled, createdAt: u.createdAt,
        ...summarize(byUser.get(u.id) ?? []),
        messages: messages.get(u.id)?.n ?? 0,
        askedBook: asked.get(u.id)?.n ?? 0,
        tasks: tasks.get(u.id)?.n ?? 0,
        supportTaken: support.get(u.id)?.taken ?? 0,
        supportDone: support.get(u.id)?.done ?? 0,
      }));
      // in sum: everyone's minutes together (sessions — each person's, added up)
      const active = people.filter((p) => p.sessions);
      const sum = (/** @type {keyof (typeof people)[number]} */ k) => people.reduce((s, p) => s + Number(p[k]), 0);
      /** @type {Record<string, number>} */
      const sections = {};
      for (const p of people) for (const [k, v] of Object.entries(p.sections)) sections[k] = (sections[k] ?? 0) + /** @type {number} */ (v);
      /** @type {Record<string, number>} */
      const devices = {};
      for (const p of people) for (const [k, v] of Object.entries(p.devices)) devices[k] = (devices[k] ?? 0) + /** @type {number} */ (v);
      /** @type {Record<string, number>} */
      const phones = {};
      for (const p of people) for (const [k, v] of Object.entries(p.phones)) phones[k] = (phones[k] ?? 0) + /** @type {number} */ (v);
      const allLengths = active.flatMap((p) => [p.shortest, p.longest]);
      const sessions = sum('sessions');
      const totals = {
        people: people.length,
        activePeople: active.length,
        sessions,
        sessionMinutes: sum('sessionMinutes'),
        average: sessions ? sum('sessionMinutes') / sessions : 0,
        shortest: allLengths.length ? Math.min(...allLengths) : 0,
        longest: allLengths.length ? Math.max(...allLengths) : 0,
        reading: sum('reading'),
        readingPerSession: sessions ? sum('reading') / sessions : 0,
        listening: sum('listening'),
        listeningPerSession: sessions ? sum('listening') / sessions : 0,
        sections,
        devices,
        phones,
        messages: sum('messages'),
        askedBook: sum('askedBook'),
        tasks: sum('tasks'),
        supportTaken: sum('supportTaken'),
        supportDone: sum('supportDone'),
        lastSeen: active.map((p) => p.lastSeen).sort().at(-1) ?? null,
      };
      return { days, since: since ? new Date(since * 60_000).toISOString() : null, totals, daily: byDay, people };
    },
  };
}
