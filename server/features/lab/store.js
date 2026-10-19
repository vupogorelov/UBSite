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

/**
 * The models to try, each as its card says: `query` and `passage` — how it wants a question and a text
 * marked ({} — the text); `spec` — for the engine (engine/embed.js): which file, how the pieces make one
 * vector; `mix`: a model of the mixed search (the first worked out of them); `book`: the model «Я и Книга»
 * answers by, alone.
 * Chosen (2026-10-19, 14 questions, 590 marks): EmbeddingGemma — the right paragraph first in 11 of 14,
 * among the first three in 12, 53 hits (e5-base: 8, 11, 37); mixed with the words it gains nothing (the
 * same first places, fewer hits) — the Book answers by it alone. e5-base stays to compare with.
 * Tried and dropped: e5-small — e5-base better in every question; bge-m3 — a draw with e5-base at twice the
 * size; Granite R2 (IBM) — as e5-base (37 hits); Qwen3-Embedding-0.6B — below e5-base at twice the size;
 * USER2-base (deepvk) — as e5-base (36 hits); paraphrase-multilingual-MiniLM — near the words (26);
 * rubert-tiny2 — below the words (7). BERTA — near Gemma (11 first, 50 hits): kept.
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
  {
    id: 'e5-base', title: 'multilingual-e5-base (Microsoft)', size: '≈280 МБ', query: 'query: {}', passage: 'passage: {}', mix: true,
    spec: { name: 'Xenova/multilingual-e5-base', pooling: 'mean' },
  },
  {
    // a Russian model (sergeyzh, MIT; learnt from FRIDA), a question and a text each with its mark, by the
    // mean. No ONNX of its own: the files are laid in data/models/sergeyzh/BERTA by hand, from DaniShe/BERTA-onnx
    // (its fp32 export, the weights unchanged), the model into onnx/
    id: 'berta', title: 'BERTA (sergeyzh)', size: '≈510 МБ', query: 'search_query: {}', passage: 'search_document: {}',
    spec: { name: 'sergeyzh/BERTA', dtype: 'fp32', pooling: 'mean' },
  },
  {
    // EmbeddingGemma's next version (Google, 2026, Apache 2.0; on Gemma 4): of text, pictures and sound — its
    // text part alone (270M); the same marks. Full precision (≈1,1 ГБ): on the video card as fast as the
    // first one at 8 bits on the processor
    id: 'gemma2', title: 'EmbeddingGemma 2 (Google)', size: '≈1,1 ГБ', query: 'task: search result | query: {}', passage: 'title: none | text: {}',
    spec: { name: 'onnx-community/embeddinggemma-2-ONNX', dtype: 'fp32', external: true, textOnly: true, pooling: 'sentence' },
  },
];
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
    -- how the vectors are worked out: threads, the video card, all models at once
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `);
  // (a model dropped from the list: its vectors and answers go — the judgements stay, they are the reader's)
  const kept = MODELS.map((m) => `'${m.id}'`).join(', ');
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
    const order = [...MODELS.map((m) => m.id), 'mix', 'book', 'words'];
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
        models: MODELS.map((m) => ({
          id: m.id, title: m.title, size: m.size,
          downloaded: existsSync(`${where.models}/${m.spec.name}`),
          done: /** @type {{ n: number }} */ (q.done.get(m.id)).n, total,
          running: jobs.has(m.id), queued: queue.includes(m.id), rate: jobs.get(m.id)?.rate ?? 0, error: errors[m.id] ?? null,
          gpu: gpuCapable(m), device: specOf(m).device === 'dml' ? 'gpu' : 'cpu',
          threads: jobs.has(m.id) ? threadsOf(m) : null,
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
      for (const m of MODELS) if (/** @type {{ n: number }} */ (q.done.get(m.id)).n < /** @type {{ n: number }} */ (q.total.get()).n) this.run(m.id);
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
      // the mixed: its model leads, the words add what it missed (mix)
      const best = MODELS.find((m) => m.mix && deep.has(m.id));
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
     * 'book' (the score: how the Book itself does).
     * @param {string} text @param {number} n
     */
    async bookAnswer(text, n) {
      text = text.trim();
      const m = MODELS.find((x) => x.book);
      if (!text || text.length > 500 || !m || !/** @type {{ n: number }} */ (q.done.get(m.id)).n || !engine.installed()) return null;
      const refs = (await closest(m, text, n)).map((x) => x.ref);
      transaction(lab, () => {
        q.clearAnswer.run(text, 'book');
        refs.forEach((ref, i) => q.putAnswer.run(text, 'book', i + 1, ref));
      });
      return refs;
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
      engine.stop();
      lab.close();
    },
  };
}
