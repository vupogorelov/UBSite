// @ts-check
// Integrations: the English text kept in step with its source — the Uversa Press edition (public
// domain) through the ubsite text API (https://ubsite.ddns.net/api). Each run asks for what changed
// since the version we hold (an empty reply or a 304 when nothing did), replaces the English of the
// paragraphs, the titles of sections, papers and parts, keeps each paragraph's Foundation number
// (`uf_ref`), and writes a report: what changed and how (text or only markup), with examples.
// Nothing is deleted here: the Russian and everything people made hang on the paragraphs.
import { transaction } from './db.js';
import { buildSearchIndex } from './search/engine.js';

const SOURCE = 'en';
const DEFAULT_URL = 'https://ubsite.ddns.net/api/v1';
const AGENT = 'UPExplorer/1.0 (+https://upexplorer.ddns.net)';
/** How many changed paragraphs a report shows. */
const SAMPLES = 15;

/** The text of a paragraph's HTML: the tags out, the three entities back. @param {string} html */
export function plainOf(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Where two texts part, with a little around it — enough to see the change. @param {string} a @param {string} b */
function aroundChange(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const from = Math.max(0, i - 40);
  const cut = (/** @type {string} */ s) => `${from > 0 ? '…' : ''}${s.slice(from, s.length - j + 40)}${s.length - j + 40 < s.length ? '…' : ''}`;
  return { before: cut(a), after: cut(b) };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ fetch?: typeof fetch, onChange?: () => void }} [opts] (tests give their own fetch; onChange — the
 *   book's text changed)
 */
export function createTextSync(db, opts = {}) {
  const get = opts.fetch ?? fetch;
  const q = {
    meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    para: db.prepare('SELECT html_en AS html, plain_en AS plain, uf_ref AS ufRef FROM paragraphs WHERE ref = ?'),
    setPara: db.prepare('UPDATE paragraphs SET html_en = ?, plain_en = ?, uf_ref = ? WHERE ref = ?'),
    section: db.prepare('SELECT title_en AS title FROM sections WHERE paper_id = ? AND num = ?'),
    setSection: db.prepare('UPDATE sections SET title_en = ? WHERE paper_id = ? AND num = ?'),
    paper: db.prepare('SELECT title_en AS title FROM papers WHERE id = ?'),
    setPaper: db.prepare('UPDATE papers SET title_en = ? WHERE id = ?'),
    part: db.prepare('SELECT title_en AS title, subtitle_en AS intro FROM parts WHERE id = ?'),
    setPart: db.prepare('UPDATE parts SET title_en = ? WHERE id = ?'),
    setPartIntro: db.prepare('UPDATE parts SET subtitle_en = ? WHERE id = ?'),
    start: db.prepare("INSERT INTO sync_runs (source, trigger, status, version_from) VALUES (?, ?, 'unchanged', ?) RETURNING id"),
    finish: db.prepare("UPDATE sync_runs SET status = ?, version_to = ?, summary = ?, finished_at = datetime('now') WHERE id = ?"),
    runs: db.prepare('SELECT id, trigger, status, version_from AS versionFrom, version_to AS versionTo, summary, started_at AS startedAt, finished_at AS finishedAt FROM sync_runs WHERE source = ? ORDER BY id DESC LIMIT ?'),
  };
  /** @param {string} key */
  const meta = (key) => /** @type {{ value: string } | undefined} */ (q.meta.get(`sync.${SOURCE}.${key}`))?.value ?? null;
  /** @param {string} key @param {string} value */
  const setMeta = (key, value) => q.setMeta.run(`sync.${SOURCE}.${key}`, value);

  function config() {
    return {
      source: SOURCE,
      title: 'Английский текст',
      provider: 'Uversa Press · ubsite',
      url: meta('url') ?? DEFAULT_URL,
      enabled: meta('enabled') === '1',
      intervalHours: Number(meta('interval') ?? 24),
      version: Number(meta('version') ?? 0),
      lastRun: meta('lastRun'),
      running,
    };
  }

  let running = false;

  /**
   * Applies a reply: replaces or adds the English of what it holds; reports what changed.
   * @param {any} reply
   */
  function apply(reply) {
    const s = { paragraphs: 0, textChanged: 0, markupOnly: 0, unchanged: 0, numbering: 0, notOurs: 0, titles: 0, removedThere: 0, samples: /** @type {any[]} */ ([]) };
    for (const rec of reply.paragraphs ?? []) {
      s.paragraphs++;
      const ours = /** @type {{ html: string, plain: string, ufRef: string | null } | undefined} */ (q.para.get(rec.ref));
      if (!ours) {
        s.notOurs++;
        continue;
      }
      const plain = plainOf(rec.html);
      if (ours.ufRef !== (rec.uf_ref ?? null) && rec.uf_ref !== rec.ref) s.numbering++;
      if (ours.html === rec.html && ours.ufRef === (rec.uf_ref ?? null)) {
        s.unchanged++;
        continue;
      }
      if (ours.html !== rec.html) {
        if (ours.plain !== plain) {
          s.textChanged++;
          if (s.samples.length < SAMPLES) s.samples.push({ ref: rec.ref, ...aroundChange(ours.plain, plain) });
        } else s.markupOnly++;
      }
      q.setPara.run(rec.html, plain, rec.uf_ref ?? null, rec.ref);
    }
    for (const rec of reply.sections ?? []) {
      const ours = /** @type {{ title: string | null } | undefined} */ (q.section.get(rec.paper, rec.section));
      if (ours && rec.title != null && ours.title !== rec.title) ((s.titles += 1), q.setSection.run(rec.title, rec.paper, rec.section));
    }
    for (const rec of reply.papers ?? []) {
      const ours = /** @type {{ title: string } | undefined} */ (q.paper.get(rec.paper));
      if (ours && rec.title && ours.title !== rec.title) ((s.titles += 1), q.setPaper.run(rec.title, rec.paper));
    }
    for (const rec of reply.parts ?? []) {
      const ours = /** @type {{ title: string, intro: string | null } | undefined} */ (q.part.get(rec.part));
      if (ours && rec.title && ours.title !== rec.title) ((s.titles += 1), q.setPart.run(rec.title, rec.part));
      // the part's introduction (who sponsored it) — its title page
      if (ours && rec.sponsor && ours.intro !== rec.sponsor) ((s.titles += 1), q.setPartIntro.run(rec.sponsor, rec.part));
    }
    // removed there: kept here (the Russian and people's notes hang on them) — only told
    for (const list of Object.values(reply.removed ?? {})) s.removedThere += /** @type {unknown[]} */ (list).length;
    return s;
  }

  /**
   * One run: asks the source, applies, reports. @param {'schedule' | 'manual'} trigger
   */
  async function run(trigger = 'manual') {
    if (running) return { status: 'busy' };
    running = true;
    const c = config();
    const { id } = /** @type {{ id: number }} */ (q.start.get(SOURCE, trigger, c.version));
    try {
      const headers = /** @type {Record<string, string>} */ ({ 'User-Agent': AGENT, 'Accept-Encoding': 'gzip' });
      const etag = meta('etag');
      if (etag && c.version) headers['If-None-Match'] = etag;
      const res = await get(`${c.url}/text?since=${c.version}`, { headers, signal: AbortSignal.timeout(60_000) });
      setMeta('lastRun', new Date().toISOString());
      if (res.status === 304) {
        q.finish.run('unchanged', c.version, JSON.stringify({ message: 'Текст не менялся' }), id);
        return { status: 'unchanged' };
      }
      if (!res.ok) throw new Error(`Источник ответил ${res.status}`);
      const reply = await res.json();
      if (reply.api !== 1 || !Number.isInteger(reply.version)) throw new Error('Источник ответил в незнакомом формате');
      const summary = transaction(db, () => apply(reply));
      if (summary.textChanged) buildSearchIndex(db); // the English search sees the new words
      setMeta('version', String(reply.version));
      const newTag = res.headers.get('etag');
      if (newTag) setMeta('etag', newTag);
      const changed = summary.textChanged + summary.markupOnly + summary.titles;
      if (changed || summary.numbering) opts.onChange?.(); // (the answers made from the book are made again)
      const report = { ...summary, made: reply.made ?? null, full: !!reply.full, credit: reply.licence?.credit_line ?? null };
      q.finish.run(changed || summary.numbering ? 'ok' : 'unchanged', reply.version, JSON.stringify(report), id);
      return { status: changed ? 'ok' : 'unchanged', version: reply.version, ...report };
    } catch (err) {
      const message = /** @type {Error} */ (err).message;
      q.finish.run('error', c.version, JSON.stringify({ message }), id);
      return { status: 'error', message };
    } finally {
      running = false;
    }
  }

  return {
    config,
    run,

    /** @param {{ url?: unknown, enabled?: unknown, intervalHours?: unknown }} b */
    setConfig(b) {
      if (typeof b.url === 'string' && /^https?:\/\/\S+$/.test(b.url.trim())) setMeta('url', b.url.trim().replace(/\/+$/, ''));
      if (typeof b.enabled === 'boolean') setMeta('enabled', b.enabled ? '1' : '0');
      if (b.intervalHours !== undefined) {
        const h = Number(b.intervalHours);
        if ([6, 12, 24, 48, 168].includes(h)) setMeta('interval', String(h));
      }
      return config();
    },

    /** The latest reports. @param {number} [limit] */
    runs(limit = 20) {
      return /** @type {any[]} */ (q.runs.all(SOURCE, limit)).map((r) => ({ ...r, summary: JSON.parse(r.summary) }));
    },

    /** Every few minutes: runs when it is on and its interval has passed. @param {number} [now] */
    async tick(now = Date.now()) {
      const c = config();
      if (!c.enabled || running) return null;
      if (c.lastRun && now - Date.parse(c.lastRun) < c.intervalHours * 3_600_000) return null;
      return run('schedule');
    },
  };
}
