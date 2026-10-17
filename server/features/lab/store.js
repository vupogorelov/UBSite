// @ts-check
// The Laboratory's data: the vectors of meaning of the book's paragraphs (both languages), per model, and
// the questions to try them on — in a file of its own (data/lab.db): the platform's database, its copies
// and the book's copy on the devices are not touched; the experiment is gone with that file.
//
// The vectors are worked out in the background (`run`): a few paragraphs at a time, with a pause between,
// in the book's order — the first papers can be asked about while the rest are still being done. A question
// is compared with every vector (a few milliseconds for the whole book): the closest paragraphs.
//
// The answers are compared by the administrator's judgement: a paragraph answers a question or not, whoever
// found it — one mark per question and paragraph, seen in every column. Each column's answer (the models,
// the word search, the mixed one) is kept with its places, so the score knows what came first.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { HttpError } from '../../http.js';
import { transaction } from '../../db.js';

/** The models to try. `prefix`: the e5 models read a question and a text each with its own mark. */
export const MODELS = [
  { id: 'e5-small', name: 'Xenova/multilingual-e5-small', title: 'multilingual-e5-small', size: '≈130 МБ', prefix: true },
  { id: 'e5-base', name: 'Xenova/multilingual-e5-base', title: 'multilingual-e5-base', size: '≈280 МБ', prefix: true },
];
const BATCH = 8;
const PAUSE = 30;
const TOP = 10;
/** How deep the mixed search looks into each of its two lists. */
const DEEP = 50;
/** Reciprocal rank fusion: a place's weight 1 / (K + place) — the usual K. */
const RRF = 60;

/** @typedef {{ ref: string, lang: 'ru' | 'en', vec: Float32Array }} Row */
/** @typedef {{ id: string, title: string, ms?: number, found: any[] } | { id: string, title: string, error: string }} Col */

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
    -- the administrator's judgement: the paragraph answers the question (1) or not (0), whoever found it
    CREATE TABLE IF NOT EXISTS judged (question TEXT NOT NULL, ref TEXT NOT NULL, good INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (question, ref)) WITHOUT ROWID;
    -- what each column answered a question, in its order (the last time it was asked)
    CREATE TABLE IF NOT EXISTS answers (question TEXT NOT NULL, col TEXT NOT NULL, rank INTEGER NOT NULL, ref TEXT NOT NULL,
      PRIMARY KEY (question, col, rank)) WITHOUT ROWID;
  `);
  // (the first marks were per column: one judgement where they agree; where they differ — left to judge again)
  if (lab.prepare("SELECT 1 FROM sqlite_master WHERE name = 'marks'").get()) {
    lab.exec(`
      INSERT OR IGNORE INTO judged (question, ref, good, created_at)
        SELECT question, ref, max(good), min(created_at) FROM marks GROUP BY question, ref HAVING min(good) = max(good);
      DROP TABLE marks;`);
  }
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
    judgedOf: lab.prepare('SELECT ref, good FROM judged WHERE question = ?'),
    judge: lab.prepare('INSERT OR REPLACE INTO judged (question, ref, good) VALUES (?, ?, ?)'),
    unjudge: lab.prepare('DELETE FROM judged WHERE question = ? AND ref = ?'),
    judgedAll: lab.prepare('SELECT question, ref, good FROM judged'),
    answersAll: lab.prepare('SELECT question, col, rank, ref FROM answers ORDER BY question, col, rank'),
    clearAnswer: lab.prepare('DELETE FROM answers WHERE question = ? AND col = ?'),
    putAnswer: lab.prepare('INSERT INTO answers (question, col, rank, ref) VALUES (?, ?, ?, ?)'),
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

  /**
   * The model's closest paragraphs to a text (each paragraph by its closer language).
   * @param {typeof MODELS[number]} m @param {string} text @param {number} n
   */
  async function closest(m, text, n) {
    const { vectors } = await engine.embed(m.name, 'query', [text], m.prefix);
    /** @type {Map<string, { score: number, lang: 'ru' | 'en' }>} */
    const best = new Map();
    for (const r of rows(m.id)) {
      let s = 0;
      for (let k = 0; k < r.vec.length; k++) s += r.vec[k] * vectors[k];
      const b = best.get(r.ref);
      if (!b || s > b.score) best.set(r.ref, { score: s, lang: r.lang });
    }
    return [...best].sort((a, b) => b[1].score - a[1].score).slice(0, n).map(([ref, b]) => ({ ref, score: Math.round(b.score * 1000) / 1000, lang: b.lang }));
  }

  /**
   * The questions with how much of their answers is judged, and each column's score: of the paragraphs it
   * answered — hits, misses, not judged; in how many questions a hit is among its first three, and at all.
   */
  function judgement() {
    /** @type {Map<string, boolean>} "question\nref" → hit */
    const judged = new Map(/** @type {any[]} */ (q.judgedAll.all()).map((j) => [`${j.question}\n${j.ref}`, !!j.good]));
    /** @type {Map<string, { col: string, asked: number, good: number, bad: number, open: number, top3: number, answered: number }>} */
    const score = new Map();
    /** @type {Map<string, Set<string>>} question → every paragraph its columns answered */
    const found = new Map();
    for (const [key, list] of Map.groupBy(/** @type {any[]} */ (q.answersAll.all()), (a) => `${a.question}\n${a.col}`)) {
      const [question, col] = key.split('\n');
      const sc = score.get(col) ?? { col, asked: 0, good: 0, bad: 0, open: 0, top3: 0, answered: 0 };
      score.set(col, sc);
      sc.asked++;
      let hit = false, early = false;
      for (const a of list) {
        if (!found.has(question)) found.set(question, new Set());
        found.get(question)?.add(a.ref);
        const j = judged.get(`${question}\n${a.ref}`);
        if (j === undefined) sc.open++;
        else if (j) {
          sc.good++;
          hit = true;
          if (a.rank <= 3) early = true;
        } else sc.bad++;
      }
      if (hit) sc.answered++;
      if (early) sc.top3++;
    }
    const questions = /** @type {any[]} */ (q.questions.all()).map((x) => {
      const js = [...(found.get(x.text) ?? [])].map((r) => judged.get(`${x.text}\n${r}`));
      return { ...x, good: js.filter((j) => j === true).length, bad: js.filter((j) => j === false).length, open: js.filter((j) => j === undefined).length };
    });
    const order = ['e5-small', 'e5-base', 'mix', 'words'];
    return { questions, score: [...score.values()].sort((a, b) => order.indexOf(a.col) - order.indexOf(b.col)) };
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
        ...judgement(),
      };
    },

    /**
     * Judges a paragraph for a question: it answers it (true), not (false), not judged (null) — in every
     * column at once. The question joins the set to try again. @param {Record<string, unknown>} b
     */
    judge(b) {
      const question = typeof b.question === 'string' ? b.question.trim() : '';
      if (!question || question.length > 500) throw new HttpError(400, 'Вопрос — до 500 знаков');
      if (typeof b.ref !== 'string' || !q.paragraph.get(b.ref)) throw new HttpError(400, 'Нет такого абзаца');
      if (b.good === null) q.unjudge.run(question, b.ref);
      else {
        q.judge.run(question, b.ref, b.good ? 1 : 0);
        q.addQuestion.run(question);
      }
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
     * A question to every model that has vectors, to the word search ("Я и Книга"'s) and to the mixed one:
     * the closest paragraphs of each column, with the paragraph's text; the judgements given before. Each
     * column's answer is kept (the score).
     * @param {string} text @param {(text: string, limit: number) => { ref: string }[]} byWords
     */
    async ask(text, byWords) {
      text = text.trim();
      if (!text || text.length > 500) throw new HttpError(400, 'Вопрос — до 500 знаков');
      const para = (/** @type {string} */ ref) => /** @type {any} */ (q.paragraph.get(ref));
      /** @type {Col[]} */
      const columns = [];
      /** The models' long lists (for the mixed one). @type {Map<string, string[]>} */
      const deep = new Map();
      for (const m of MODELS) {
        if (!/** @type {{ n: number }} */ (q.done.get(m.id)).n) continue;
        const t = Date.now();
        try {
          const top = await closest(m, text, DEEP);
          deep.set(m.id, top.map((x) => x.ref));
          columns.push({ id: m.id, title: m.title, ms: Date.now() - t, found: top.slice(0, TOP).map((x) => ({ ...para(x.ref), score: x.score, lang: x.lang })) });
        } catch (err) {
          columns.push({ id: m.id, title: m.title, error: /** @type {Error} */ (err).message });
        }
      }
      const words = byWords(text, DEEP).map((p) => p.ref);
      // the mixed: the words and the last (larger) counted model, by reciprocal rank fusion
      const best = [...MODELS].reverse().find((m) => deep.has(m.id));
      if (best) {
        /** @type {Map<string, number>} */
        const weight = new Map();
        for (const list of [words, /** @type {string[]} */ (deep.get(best.id))]) list.forEach((ref, i) => weight.set(ref, (weight.get(ref) ?? 0) + 1 / (RRF + i + 1)));
        const mixed = [...weight].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([ref]) => para(ref));
        columns.push({ id: 'mix', title: `Смешанный: слова + ${best.title}`, found: mixed });
      }
      columns.push({ id: 'words', title: 'По словам («Я и Книга»)', found: words.slice(0, TOP).map(para) });
      transaction(lab, () => {
        for (const c of columns) {
          if (!('found' in c)) continue;
          q.clearAnswer.run(text, c.id);
          c.found.forEach((x, i) => q.putAnswer.run(text, c.id, i + 1, x.ref));
        }
      });
      /** @type {Record<string, boolean>} */
      const judged = {};
      for (const j of /** @type {any[]} */ (q.judgedOf.all(text))) judged[j.ref] = !!j.good;
      return { text, columns, judged };
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
