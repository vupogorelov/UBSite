// @ts-check
// The Laboratory's data: the vectors of meaning of the book's paragraphs (both languages), per model, and
// the questions to try them on — in a file of its own (data/lab.db): the platform's database, its copies
// and the book's copy on the devices are not touched; the experiment is gone with that file.
//
// The vectors are worked out in the background (`run`): 32 paragraphs of a like length at a time, each model
// in a process of its own — one model after another, or all at once (`configure`: the processor's threads
// shared between them; the video card for the full-precision ones). A question is compared with every
// vector (a few milliseconds for the whole book): the closest paragraphs.
//
// The answers are compared by the administrator's judgement: a paragraph answers a question or not, whoever
// found it — one mark per question and paragraph, seen in every column. Each column's answer (the models,
// the word search, the mixed one) is kept with its places, so the score knows what came first.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { HttpError } from '../../http.js';
import { transaction } from '../../db.js';
import { langOf, messagesFor, MAX_TOKENS } from '../../reply.js';

/**
 * The models to try, each as its card says: `query` and `passage` — how it wants a question and a text
 * marked ({} — the text); `spec` — for the engine (engine/embed.js): which file, how the pieces make one
 * vector; `mix`: a model of the mixed search (the first worked out of them); `book`: the model «Я и Книга»
 * answers by, alone.
 * Chosen (2026-10-19, 17 questions, 1062 marks): EmbeddingGemma — the best for what it costs: the right
 * paragraph first in 12 of 17, among the first three in 13, 60 hits, at ≈310 МБ; mixed with the words it
 * gains nothing — the Book answers by it alone. A model to compare with: added here (and its vectors worked
 * out), dropped again when judged — its vectors and answers go, the judgements stay.
 * Tried and dropped: Giga-Embeddings 480M (SaluteDevices) — the best (13 first, 15 in three, 62 hits), but six
 * times the size (≈1,9 ГБ); BERTA (sergeyzh) — near Gemma (12, 13, 56); e5-base (9, 14, 45); EmbeddingGemma 2
 * — below the first one (8, 11, 38); e5-small, bge-m3, Granite R2, Qwen3-Embedding-0.6B, USER2-base,
 * paraphrase-multilingual-MiniLM, rubert-tiny2 — at e5-base's level or below. Mixing two models (by their
 * first ten): more hits, not more in the first three.
 * @typedef {import('./engine-client.js').Spec} Spec
 * @type {{ id: string, title: string, size: string, query: string, passage: string, spec: Spec, mix?: boolean, book?: boolean }[]}
 */
export const MODELS = [
  {
    // Google, 2025, the Gemma terms; the model makes the sentence's vector itself
    id: 'gemma', title: 'embeddinggemma-300m (Google)', size: '≈310 МБ', query: 'task: search result | query: {}', passage: 'title: none | text: {}',
    mix: true, book: true,
    spec: { name: 'onnx-community/embeddinggemma-300m-ONNX', external: true, pooling: 'sentence' },
  },
];
/**
 * The small generative models to try for «Я и Книга»'s answers in the Book's own words (server/reply.js): each answers the
 * saved questions from the paragraphs the Book's model found; the administrator judges — true to the text or not.
 * 4-bit, on the processor (on DirectML they write nonsense): ≈5–12 words a second. `book`: the one «Я и Книга»
 * answers with.
 * Chosen (2026-10-19, 17 questions): Gemma 4 E2B — true to the text in 14 of 17, ≈9 s an answer (two of its three
 * misses — the paragraphs found were not about it; the third — «not directly» where something close was there).
 * Tried and dropped: Gemma 4 E4B — 13 of 17, ≈17 s; Qwen3.5-4B — 13 of 17, ≈27 s.
 * `remote`: a model of a service reached through the application's AI connection (server/ai.js) — nothing on
 * this server; its free ones (OpenRouter: ≈50 requests a day for the whole account).
 * @typedef {{ id: string, title: string, size: string, book?: boolean } & ({ spec: import('./engine-client.js').Writer, remote?: undefined } | { remote: { model: string }, spec?: undefined })} WriterModel
 * @type {WriterModel[]}
 */
export const WRITERS = [
  { id: 'gemma4-e2b', title: 'Gemma 4 E2B (Google)', size: '≈3,9 ГБ', book: true, spec: { name: 'onnx-community/gemma-4-E2B-it-ONNX', cls: 'Gemma4ForConditionalGeneration' } },
  { id: 'or-gemma4-31b', title: 'Gemma 4 31B (Google) · OpenRouter', size: 'удалённо', remote: { model: 'google/gemma-4-31b-it:free' } },
  { id: 'or-nemotron-ultra', title: 'Nemotron 3 Ultra 550B (NVIDIA) · OpenRouter', size: 'удалённо', remote: { model: 'nvidia/nemotron-3-ultra-550b-a55b:free' } },
];
/** How many paragraphs a written answer is made from (as many as «Я и Книга» answers with). */
const FROM = 3;

/** A text marked as the model wants it. @param {string} template @param {string} text */
const marked = (template, text) => template.replace('{}', () => text);
/**
 * Whether a model can work on the video card: full precision only — there its vectors are the processor's
 * (checked: USER2-base, BERTA, 6–7 times faster on an RTX 4060); the 8-bit ones come out different, and a
 * question must be turned into a vector the way the paragraphs were.
 * @param {{ spec: Spec }} m
 */
export const gpuCapable = (m) => m.spec.dtype === 'fp32';

/**
 * The mixed search: the model's first two stay where they are (it finds what is meant); after them its
 * list and the words' are merged by reciprocal rank fusion — the words add what the model missed (events,
 * rare words: «менялы»), not taking its first places. Of the ways tried on the judged questions, the
 * one as good as the model at the top (8 of 10 in the first three) that finds the most (29 hits).
 * @param {string[]} model the model's closest, best first @param {string[]} words the word search's
 * @returns {string[]}
 */
export function mix(model, words) {
  const head = model.slice(0, 2);
  /** @type {Map<string, number>} */
  const weight = new Map();
  for (const list of [model, words]) list.forEach((ref, i) => weight.set(ref, (weight.get(ref) ?? 0) + 1 / (RRF + i + 1)));
  return [...head, ...[...weight].sort((a, b) => b[1] - a[1]).map(([ref]) => ref).filter((ref) => !head.includes(ref))];
}
/** Paragraphs per batch: of a like length (less padding) — the engine does 32 at once much faster than 8. */
const BATCH = 32;
/** The processor threads: up to the machine's 16 logical cores; 8 unless set. */
const MAX_THREADS = 16;
/** A model on the video card: two threads of the processor are enough for it. */
const GPU_THREADS = 2;
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
 * @param {{ file: string, models: string, ai?: (model: string, messages: { role: string, content: string }[], max: number) => Promise<{ text: string, tokens: number }>, aiReady?: () => boolean }} where
 *   the lab's database file; the models' folder; the remote writing models' way (the application's AI connection) and whether it is connected
 * @param {typeof MODELS} [list] the models (a test's own)
 * @param {typeof WRITERS} [writers] the writing models (a test's own)
 */
export function createLab(db, engine, where, list = MODELS, writers = WRITERS) {
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
    -- how the vectors are worked out: threads, the video card, all models at once
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    -- a writing model's answer to a saved question, from the paragraphs (refs: JSON); good — the administrator's
    -- judgement: true to the text and to the point (1) or not (0)
    CREATE TABLE IF NOT EXISTS replies (question TEXT NOT NULL, model TEXT NOT NULL, refs TEXT NOT NULL, text TEXT NOT NULL,
      ms INTEGER NOT NULL, tokens INTEGER NOT NULL, good INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (question, model)) WITHOUT ROWID;
  `);
  lab.exec(`DELETE FROM replies WHERE model NOT IN (${writers.map((w) => `'${w.id}'`).join(', ') || "''"})`);
  // (a model dropped from the list: its vectors and answers go — the judgements stay, they are the reader's)
  const kept = list.map((m) => `'${m.id}'`).join(', ');
  lab.exec(`DELETE FROM vectors WHERE model NOT IN (${kept}); DELETE FROM answers WHERE col NOT IN (${kept}, 'mix', 'words');`);
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
    replies: lab.prepare('SELECT question, model, refs, text, ms, tokens, good FROM replies'),
    putReply: lab.prepare('INSERT OR REPLACE INTO replies (question, model, refs, text, ms, tokens, good) VALUES (?, ?, ?, ?, ?, ?, NULL)'),
    judgeReply: lab.prepare('UPDATE replies SET good = ? WHERE question = ? AND model = ?'),
    settings: lab.prepare('SELECT key, value FROM settings'),
    setting: lab.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  };

  /** How the vectors are worked out: the processor's threads (shared by the models working on it), the video card for the models that can, all asked-for models at once (else in turn). */
  const settings = { threads: 8, gpu: false, together: false };
  for (const s of /** @type {{ key: string, value: string }[]} */ (q.settings.all())) {
    if (s.key in settings) /** @type {any} */ (settings)[s.key] = JSON.parse(s.value);
  }

  /** Each model's vectors in memory (made when first asked; grown as more are worked out). @type {Map<string, Row[]>} */
  const loaded = new Map();
  /**
   * The work in the background: the models at work (each in its process, `stop` — paused after its batch),
   * the ones waiting in turn (not all at once), the last error of each.
   */
  const jobs = /** @type {Map<string, { stop: boolean, rate: number }>} */ (new Map());
  let queue = /** @type {string[]} */ ([]);
  const errors = /** @type {Record<string, string>} */ ({});
  /** The writing in the background: one model at a time (gigabytes each), the saved questions in turn. */
  const writing = { model: /** @type {string | null} */ (null), stop: false, done: 0, of: 0, error: /** @type {Record<string, string>} */ ({}) };
  /** A writing model answers one at a time — the Laboratory's questions and «Я и Книга»'s alike. */
  let line = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const serial = (fn) => {
    const run = line.then(fn, fn);
    line = run.then(() => {}, () => {});
    return run;
  };
  /** The paragraphs to answer from, in the question's language. @param {string} question @param {string[]} refs */
  const paragraphsFor = (question, refs) => {
    const lang = langOf(question);
    return refs.map((ref) => ({ ref, text: /** @type {any} */ (q.paragraph.get(ref))[lang] }));
  };
  /** A writing model's answer to a question from the paragraphs. @param {typeof WRITERS[number]} w @param {string} question @param {string[]} refs */
  const writeFrom = (w, question, refs) => {
    const messages = messagesFor(question, paragraphsFor(question, refs));
    if (w.remote) {
      // (a thinking model's thoughts count too: room for them)
      if (!where.ai) throw new HttpError(409, 'Нейросеть приложения не подключена');
      return where.ai(w.remote.model, messages, MAX_TOKENS * 4);
    }
    const spec = w.spec;
    return serial(() => engine.write(spec, messages, { threads: settings.threads, max: MAX_TOKENS }));
  };

  /** The spec as the engine is to run it now: on the video card when chosen and the model can. @param {typeof MODELS[number]} m @returns {Spec} */
  const specOf = (m) => (settings.gpu && gpuCapable(m) ? { ...m.spec, device: 'dml' } : m.spec);
  /**
   * The processor threads of a model at work: on the video card — a few; on the processor — its share of
   * them all with the others working on it.
   * @param {typeof MODELS[number]} m
   */
  const threadsOf = (m) => {
    if (specOf(m).device === 'dml') return GPU_THREADS;
    const onCpu = [...jobs.keys()].filter((id) => specOf(modelOf(id)).device !== 'dml').length;
    return Math.max(1, Math.floor(settings.threads / Math.max(1, onCpu)));
  };

  /** @param {string} id */
  const modelOf = (id) => {
    const m = list.find((x) => x.id === id);
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

  /**
   * Works out the model's missing vectors, a batch at a time, until done or paused: the texts by length (a
   * batch of like ones — less padding), each batch with the threads the model has now (they change as other
   * models start and finish).
   * @param {typeof MODELS[number]} m @param {{ stop: boolean, rate: number }} job
   */
  async function work(m, job) {
    const have = new Set(/** @type {{ ref: string, lang: string }[]} */ (q.have.all(m.id)).map((x) => `${x.ref} ${x.lang}`));
    /** @type {{ ref: string, lang: 'ru' | 'en', text: string }[]} */
    const todo = [];
    for (const p of /** @type {{ ref: string, ru: string, en: string }[]} */ (q.paragraphs.all())) {
      for (const lang of /** @type {const} */ (['ru', 'en'])) if (p[lang] && !have.has(`${p.ref} ${lang}`)) todo.push({ ref: p.ref, lang, text: p[lang] });
    }
    todo.sort((a, b) => a.text.length - b.text.length);
    const started = Date.now();
    for (let i = 0; i < todo.length && !job.stop; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const { vectors, dims } = await engine.embed(specOf(m), part.map((x) => marked(m.passage, x.text)), { threads: threadsOf(m), exact: true });
      transaction(lab, () =>
        part.forEach((x, k) => {
          const vec = vectors.slice(k * dims, (k + 1) * dims);
          q.put.run(m.id, x.ref, x.lang, new Uint8Array(vec.buffer));
          loaded.get(m.id)?.push({ ref: x.ref, lang: x.lang, vec });
        }),
      );
      job.rate = Math.round(((i + part.length) / Math.max(1, Date.now() - started)) * 60_000);
      await new Promise((r) => setImmediate(r)); // (the server's other work goes first)
    }
  }

  /** Starts the model's work; when it ends, the next in turn (one at a time unless all at once). @param {typeof MODELS[number]} m */
  function begin(m) {
    const job = { stop: false, rate: 0 };
    jobs.set(m.id, job);
    delete errors[m.id];
    void work(m, job)
      .catch((err) => (errors[m.id] = /** @type {Error} */ (err).message))
      .finally(() => {
        jobs.delete(m.id);
        next();
      });
  }
  /** The models in turn: started while there is room (all at once, or one). */
  function next() {
    while (queue.length && (settings.together || !jobs.size)) begin(modelOf(/** @type {string} */ (queue.shift())));
  }

  /**
   * The model's closest paragraphs to a text (each paragraph by its closer language).
   * @param {typeof MODELS[number]} m @param {string} text @param {number} n
   */
  async function closest(m, text, n) {
    const { vectors } = await engine.embed(specOf(m), [marked(m.query, text)], { threads: settings.threads });
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
    const order = [...list.map((m) => m.id), 'mix', 'book', 'words'];
    return { questions, score: [...score.values()].sort((a, b) => order.indexOf(a.col) - order.indexOf(b.col)) };
  }

  return {
    /** What there is: the engine, each model (downloaded, how much is worked out, working now), the questions. */
    status() {
      const total = /** @type {{ n: number }} */ (q.total.get()).n;
      return {
        installed: engine.installed(),
        engineRunning: engine.running(),
        settings: { ...settings, maxThreads: MAX_THREADS },
        models: list.map((m) => ({
          id: m.id, title: m.title, size: m.size,
          downloaded: existsSync(`${where.models}/${m.spec.name}`),
          done: /** @type {{ n: number }} */ (q.done.get(m.id)).n, total,
          running: jobs.has(m.id), queued: queue.includes(m.id), rate: jobs.get(m.id)?.rate ?? 0, error: errors[m.id] ?? null,
          gpu: gpuCapable(m), device: specOf(m).device === 'dml' ? 'gpu' : 'cpu',
          threads: jobs.has(m.id) ? threadsOf(m) : null,
        })),
        ...judgement(),
        // the writing models: how many saved questions each answered, how well, how fast
        writers: writers.map((w) => {
          const saved = new Set(/** @type {{ text: string }[]} */ (q.questions.all()).map((x) => x.text));
          const rows = /** @type {any[]} */ (q.replies.all()).filter((r) => r.model === w.id && saved.has(r.question));
          return {
            id: w.id, title: w.title, size: w.size,
            downloaded: w.spec ? existsSync(`${where.models}/${w.spec.name}`) : true,
            remote: !!w.remote, ready: w.remote ? !!where.aiReady?.() : true,
            answered: rows.length, of: saved.size,
            good: rows.filter((r) => r.good === 1).length, bad: rows.filter((r) => r.good === 0).length,
            ms: rows.length ? Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length) : 0,
            running: writing.model === w.id, progress: writing.model === w.id ? { done: writing.done, of: writing.of } : null,
            error: writing.error[w.id] ?? null,
          };
        }),
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

    /** Starts working out a model's vectors — at once, or in turn after the one at work (as set). @param {string} id */
    run(id) {
      modelOf(id);
      if (!engine.installed()) throw new HttpError(503, 'Движок модели не установлен (server/features/lab/engine: npm install)');
      const job = jobs.get(id);
      if (job) return void (job.stop = false); // (paused, its batch not yet done: goes on)
      if (!queue.includes(id)) queue.push(id);
      next();
    },
    /** Every model not worked out to the end: started (at once or in turn). */
    runAll() {
      for (const m of list) if (/** @type {{ n: number }} */ (q.done.get(m.id)).n < /** @type {{ n: number }} */ (q.total.get()).n) this.run(m.id);
    },

    /** Stops a model's work after its batch (or every model's; the ones waiting in turn wait no more). @param {string} [id] */
    pause(id) {
      if (id) {
        queue = queue.filter((x) => x !== id);
        const job = jobs.get(id);
        if (job) job.stop = true;
        return;
      }
      queue = [];
      for (const job of jobs.values()) job.stop = true;
    },

    /**
     * Changes how the vectors are worked out: { threads: 1–16, gpu, together } (any of them). The work going on
     * takes them from its next batch; all at once — the models waiting in turn start.
     * @param {Record<string, unknown>} b
     */
    configure(b) {
      if (b.threads !== undefined) {
        const t = Number(b.threads);
        if (!Number.isInteger(t) || t < 1 || t > MAX_THREADS) throw new HttpError(400, `Потоков — от 1 до ${MAX_THREADS}`);
        settings.threads = t;
      }
      for (const k of /** @type {const} */ (['gpu', 'together'])) if (b[k] !== undefined) settings[k] = !!b[k];
      transaction(lab, () => {
        for (const [k, v] of Object.entries(settings)) q.setting.run(k, JSON.stringify(v));
      });
      next();
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
      for (const m of list) {
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
      // the mixed: its model leads, the words add what it missed (mix)
      const best = list.find((m) => m.mix && deep.has(m.id));
      if (best) {
        const found = mix(/** @type {string[]} */ (deep.get(best.id)), words).slice(0, TOP).map(para);
        columns.push({ id: 'mix', title: `Смешанный: ${best.id} + слова`, found });
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

    /**
     * «Я и Книга» answered by its model (`book`: EmbeddingGemma) alone: the refs, best first — null when the
     * model is not worked out yet (the Book answers by the words then). The answer is kept as the column
     * 'book' (the score: how the Book itself does) — when `keep` (the administrator's).
     * @param {string} text @param {number} n @param {boolean} [keep]
     */
    async bookAnswer(text, n, keep = true) {
      text = text.trim();
      const m = list.find((x) => x.book);
      if (!text || text.length > 500 || !m || !/** @type {{ n: number }} */ (q.done.get(m.id)).n || !engine.installed()) return null;
      const refs = (await closest(m, text, n)).map((x) => x.ref);
      // (kept for the score: the administrator's own questions only — a reader's are theirs)
      if (keep) transaction(lab, () => {
        q.clearAnswer.run(text, 'book');
        refs.forEach((ref, i) => q.putAnswer.run(text, 'book', i + 1, ref));
      });
      return refs;
    },

    /**
     * The platform's search by meaning (server/meaning.js), by the Book's model: `meaning` — its closest;
     * `hybrid` — as the mixed column: its first two, then its list and the words' merged. Null — the model
     * is not worked out yet. Nothing is kept (the Laboratory's score is of its own questions).
     * @param {string} text @param {'meaning' | 'hybrid'} mode @param {number} n
     * @param {(text: string, limit: number) => { ref: string }[]} byWords
     */
    async find(text, mode, n, byWords) {
      const m = list.find((x) => x.book);
      if (!m || !/** @type {{ n: number }} */ (q.done.get(m.id)).n || !engine.installed()) return null;
      const model = (await closest(m, text, Math.max(n, DEEP))).map((x) => x.ref);
      return (mode === 'hybrid' ? mix(model, byWords(text, DEEP).map((p) => p.ref)) : model).slice(0, n);
    },

    /**
     * A writing model answers the saved questions in the Book's words (those it has not answered; `again` — all),
     * each from the paragraphs the Book's model finds for it; in the background, one model at a time. Its
     * process is let go at the end (gigabytes).
     * @param {string} id @param {boolean} [again]
     */
    write(id, again = false) {
      const w = writers.find((x) => x.id === id);
      if (!w) throw new HttpError(404, 'Нет такой модели');
      if (!engine.installed()) throw new HttpError(503, 'Движок модели не установлен (server/features/lab/engine: npm install)');
      if (w.remote && !where.aiReady?.()) throw new HttpError(409, 'Сначала подключите нейросеть приложения');
      const book = list.find((x) => x.book);
      if (!book || !(/** @type {{ n: number }} */ (q.done.get(book.id)).n)) throw new HttpError(409, 'Сначала посчитайте модель поиска по смыслу');
      if (writing.model) throw new HttpError(409, 'Сейчас отвечает другая модель — дождитесь или поставьте на паузу');
      const answered = new Set(/** @type {any[]} */ (q.replies.all()).filter((r) => r.model === id).map((r) => r.question));
      const todo = /** @type {{ text: string }[]} */ (q.questions.all()).map((x) => x.text).filter((t) => again || !answered.has(t)).reverse();
      Object.assign(writing, { model: id, stop: false, done: 0, of: todo.length });
      delete writing.error[id];
      void (async () => {
        try {
          for (const question of todo) {
            if (writing.stop) break;
            const refs = (await closest(book, question, FROM)).map((x) => x.ref);
            const t = Date.now();
            const { text, tokens } = await writeFrom(w, question, refs);
            q.putReply.run(question, id, JSON.stringify(refs), text, Date.now() - t, tokens);
            writing.done++;
          }
        } catch (err) {
          writing.error[id] = /** @type {Error} */ (err).message;
        } finally {
          writing.model = null;
          if (w.spec) engine.release(w.spec.name);
        }
      })();
    },
    /**
     * «Я и Книга»'s answer in the Book's own words, by its writing model (`book`), from the paragraphs found;
     * null — no such model or engine. @param {string} question @param {string[]} refs
     */
    async bookWrite(question, refs) {
      const w = writers.find((x) => x.book);
      if (!w || !engine.installed() || !refs.length) return null;
      return (await writeFrom(w, question, refs)).text || null;
    },
    /** The writing stops after the answer in hand. */
    pauseWriting() {
      writing.stop = true;
    },
    /**
     * The written answers, per saved question (newest first): the paragraphs they were made from, each model's
     * answer with its time and judgement.
     */
    replies() {
      const by = Map.groupBy(/** @type {any[]} */ (q.replies.all()), (r) => r.question);
      return /** @type {{ text: string }[]} */ (q.questions.all())
        .filter((x) => by.has(x.text))
        .map((x) => {
          const rows = /** @type {any[]} */ (by.get(x.text));
          return {
            question: x.text,
            refs: /** @type {string[]} */ (JSON.parse(rows[0].refs)),
            answers: Object.fromEntries(rows.map((r) => [r.model, { text: r.text, ms: r.ms, tokens: r.tokens, good: r.good === null ? null : !!r.good }])),
          };
        });
    },
    /** A written answer judged: true to the text and to the point (true), not (false), not judged (null). @param {Record<string, unknown>} b */
    judgeReply(b) {
      if (typeof b.question !== 'string' || typeof b.model !== 'string') throw new HttpError(400, 'Нужны вопрос и модель');
      q.judgeReply.run(b.good === null ? null : b.good ? 1 : 0, b.question, b.model);
    },

    /** The judgement of a paragraph for a question: true, false, or null — not judged. @param {string} question @param {string} ref */
    judgedFor(question, ref) {
      const j = /** @type {any[]} */ (q.judgedOf.all(question.trim())).find((x) => x.ref === ref);
      return j ? !!j.good : null;
    },

    /**
     * What is left to judge: per saved question, the paragraphs its columns answered and nobody judged yet —
     * each once, with its text and who found it at which place (the best place first).
     */
    todo() {
      const judged = new Set(/** @type {any[]} */ (q.judgedAll.all()).map((j) => `${j.question}\n${j.ref}`));
      const saved = new Set(/** @type {any[]} */ (q.questions.all()).map((x) => x.text));
      /** @type {Map<string, Map<string, { col: string, rank: number }[]>>} question → ref → found by */
      const open = new Map();
      for (const a of /** @type {any[]} */ (q.answersAll.all())) {
        if (!saved.has(a.question) || judged.has(`${a.question}\n${a.ref}`)) continue;
        const refs = open.get(a.question) ?? open.set(a.question, new Map()).get(a.question);
        const by = refs?.get(a.ref) ?? [];
        by.push({ col: a.col, rank: a.rank });
        refs?.set(a.ref, by);
      }
      return [...open].map(([question, refs]) => ({
        question,
        items: [...refs]
          .map(([ref, by]) => ({ ...(/** @type {any} */ (q.paragraph.get(ref))), by: by.sort((x, y) => x.rank - y.rank) }))
          .sort((x, y) => x.by[0].rank - y.by[0].rank),
      }));
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
      this.pause();
      writing.stop = true;
      engine.stop();
      lab.close();
    },
  };
}
