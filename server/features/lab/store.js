// @ts-check
// The Laboratory's data: the vectors of meaning of the book's paragraphs (both languages), per model, and
// the questions to try them on — in a file of its own (data/lab.db): the platform's database, its copies
// and the book's copy on the devices are not touched; the experiment is gone with that file.
//
// The vectors are worked out in the background (`run`): a few paragraphs at a time, with a pause between,
// in the book's order — the first papers can be asked about while the rest are still being done. A question
// is compared with every vector (a few milliseconds for the whole book): the closest paragraphs.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { HttpError } from '../../http.js';

/** The models to try. `prefix`: the e5 models read a question and a text each with its own mark. */
export const MODELS = [
  { id: 'e5-small', name: 'Xenova/multilingual-e5-small', title: 'multilingual-e5-small', size: '≈130 МБ', prefix: true },
  { id: 'e5-base', name: 'Xenova/multilingual-e5-base', title: 'multilingual-e5-base', size: '≈280 МБ', prefix: true },
];
const BATCH = 8;
const PAUSE = 30;
const TOP = 10;

/** @typedef {{ ref: string, lang: 'ru' | 'en', vec: Float32Array }} Row */

/**
 * @param {DatabaseSync} db the platform's database (the paragraphs are read from it)
 * @param {ReturnType<typeof import('./engine-client.js').createEngine>} engine
 * @param {{ file: string, models: string }} where the lab's database file; the models' folder
 */
export function createLab(db, engine, where) {
  const lab = new DatabaseSync(where.file);
  lab.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS vectors (model TEXT NOT NULL, ref TEXT NOT NULL, lang TEXT NOT NULL, vec BLOB NOT NULL,
      PRIMARY KEY (model, ref, lang)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  const q = {
    paragraphs: db.prepare('SELECT ref, plain_ru AS ru, plain_en AS en FROM paragraphs ORDER BY seq'),
    total: db.prepare("SELECT (SELECT count(*) FROM paragraphs WHERE plain_ru <> '') + (SELECT count(*) FROM paragraphs WHERE plain_en <> '') AS n"),
    paragraph: db.prepare('SELECT p.ref, p.plain_ru AS ru, p.plain_en AS en, pp.title_ru AS paperTitle FROM paragraphs p JOIN papers pp ON pp.id = p.paper_id WHERE p.ref = ?'),
    done: lab.prepare('SELECT count(*) AS n FROM vectors WHERE model = ?'),
    have: lab.prepare('SELECT ref, lang FROM vectors WHERE model = ?'),
    all: lab.prepare('SELECT ref, lang, vec FROM vectors WHERE model = ?'),
    put: lab.prepare('INSERT OR REPLACE INTO vectors (model, ref, lang, vec) VALUES (?, ?, ?, ?)'),
    questions: lab.prepare('SELECT id, text, created_at AS createdAt FROM questions ORDER BY id DESC'),
    addQuestion: lab.prepare('INSERT OR IGNORE INTO questions (text) VALUES (?)'),
    removeQuestion: lab.prepare('DELETE FROM questions WHERE id = ?'),
  };

  /** Each model's vectors in memory (made when first asked; grown as more are worked out). @type {Map<string, Row[]>} */
  const loaded = new Map();
  /** The work in the background: one model at a time (the engine holds one). */
  const job = { model: /** @type {string | null} */ (null), stop: false, error: /** @type {Record<string, string>} */ ({}), rate: 0 };

  /** @param {string} id */
  const modelOf = (id) => {
    const m = MODELS.find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'Нет такой модели');
    return m;
  };

  /** @param {string} model */
  function rows(model) {
    let r = loaded.get(model);
    if (!r) {
      r = /** @type {any[]} */ (q.all.all(model)).map((x) => ({ ref: x.ref, lang: x.lang, vec: new Float32Array(x.vec.buffer.slice(x.vec.byteOffset, x.vec.byteOffset + x.vec.byteLength)) }));
      loaded.set(model, r);
    }
    return r;
  }

  /** Works out the model's missing vectors, a batch at a time, until done or paused. @param {typeof MODELS[number]} m */
  async function work(m) {
    const have = new Set(/** @type {{ ref: string, lang: string }[]} */ (q.have.all(m.id)).map((x) => `${x.ref} ${x.lang}`));
    /** @type {{ ref: string, lang: 'ru' | 'en', text: string }[]} */
    const todo = [];
    for (const p of /** @type {{ ref: string, ru: string, en: string }[]} */ (q.paragraphs.all())) {
      for (const lang of /** @type {const} */ (['ru', 'en'])) if (p[lang] && !have.has(`${p.ref} ${lang}`)) todo.push({ ref: p.ref, lang, text: p[lang] });
    }
    const started = Date.now();
    for (let i = 0; i < todo.length && !job.stop; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const { vectors, dims } = await engine.embed(m.name, 'passage', part.map((x) => x.text), m.prefix);
      part.forEach((x, k) => {
        const vec = vectors.slice(k * dims, (k + 1) * dims);
        q.put.run(m.id, x.ref, x.lang, new Uint8Array(vec.buffer));
        loaded.get(m.id)?.push({ ref: x.ref, lang: x.lang, vec });
      });
      job.rate = Math.round(((i + part.length) / Math.max(1, Date.now() - started)) * 60_000);
      await new Promise((r) => setTimeout(r, PAUSE)); // (the server's other work goes first)
    }
  }

  return {
    /** What there is: the engine, each model (downloaded, how much is worked out, working now), the questions. */
    status() {
      const total = /** @type {{ n: number }} */ (q.total.get()).n;
      return {
        installed: engine.installed(),
        engineRunning: engine.running(),
        models: MODELS.map((m) => ({
          id: m.id, title: m.title, size: m.size,
          downloaded: existsSync(`${where.models}/${m.name}`),
          done: /** @type {{ n: number }} */ (q.done.get(m.id)).n, total,
          running: job.model === m.id, rate: job.model === m.id ? job.rate : 0, error: job.error[m.id] ?? null,
        })),
        questions: q.questions.all(),
      };
    },

    /** Starts working out a model's vectors (another model's work stops first). @param {string} id */
    run(id) {
      const m = modelOf(id);
      if (!engine.installed()) throw new HttpError(503, 'Движок модели не установлен (server/features/lab/engine: npm install)');
      if (job.model === id) return void (job.stop = false); // (paused, its batch not yet done: goes on)
      job.stop = true;
      const go = async () => {
        while (job.model) await new Promise((r) => setTimeout(r, 100)); // (the other one finishes its batch)
        job.model = id;
        job.stop = false;
        job.rate = 0;
        delete job.error[id];
        try {
          await work(m);
        } catch (err) {
          job.error[id] = /** @type {Error} */ (err).message;
        } finally {
          job.model = null;
        }
      };
      void go();
    },

    /** Stops the work after its batch. */
    pause() {
      job.stop = true;
    },

    /**
     * A question to every model that has vectors, and to the word search ("Я и Книга"'s): the closest
     * paragraphs of each, with the paragraph's text.
     * @param {string} text @param {(text: string, limit: number) => { ref: string }[]} byWords
     */
    async ask(text, byWords) {
      text = text.trim();
      if (!text || text.length > 500) throw new HttpError(400, 'Вопрос — до 500 знаков');
      const para = (/** @type {string} */ ref) => /** @type {any} */ (q.paragraph.get(ref));
      /** @type {Record<string, { ms: number, found: any[] } | { error: string }>} */
      const models = {};
      for (const m of MODELS) {
        if (!/** @type {{ n: number }} */ (q.done.get(m.id)).n) continue;
        const t = Date.now();
        try {
          const { vectors } = await engine.embed(m.name, 'query', [text], m.prefix);
          /** @type {Map<string, { score: number, lang: string }>} */
          const best = new Map();
          for (const r of rows(m.id)) {
            let s = 0;
            for (let k = 0; k < r.vec.length; k++) s += r.vec[k] * vectors[k];
            const b = best.get(r.ref);
            if (!b || s > b.score) best.set(r.ref, { score: s, lang: r.lang });
          }
          const top = [...best].sort((a, b) => b[1].score - a[1].score).slice(0, TOP);
          models[m.id] = { ms: Date.now() - t, found: top.map(([ref, b]) => ({ ...para(ref), score: Math.round(b.score * 1000) / 1000, lang: b.lang })) };
        } catch (err) {
          models[m.id] = { error: /** @type {Error} */ (err).message };
        }
      }
      return { text, models, words: byWords(text, TOP).map((p) => para(p.ref)) };
    },

    /** @param {unknown} text */
    addQuestion(text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new HttpError(400, 'Вопрос — до 500 знаков');
      q.addQuestion.run(text.trim());
    },
    /** @param {number} id */
    removeQuestion(id) {
      q.removeQuestion.run(id);
    },
    close() {
      job.stop = true;
      engine.stop();
      lab.close();
    },
  };
}
