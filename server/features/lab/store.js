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

/**
 * The models to try, each as its card says: `query` and `passage` — how it wants a question and a text
 * marked ({} — the text); `spec` — for the engine (engine/embed.js): which file, how the pieces make one
 * vector; `mix`: a model of the mixed search (the first worked out of them); `book`: the model «Я и Книга»
 * answers by, alone.
 * Chosen (2026-10-19, 14 questions, 590 marks): EmbeddingGemma — the right paragraph first in 11 of 14,
 * among the first three in 12, 53 hits (e5-base: 8, 11, 37); mixed with the words it gains nothing (the
 * same first places, fewer hits) — the Book answers by it alone. e5-base stays to compare with.
 * Tried and dropped: e5-small — e5-base better in every question; bge-m3 — a draw with e5-base at twice the
 * size; Granite R2 (IBM) — as e5-base (37 hits); Qwen3-Embedding-0.6B — below e5-base at twice the size.
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
    // a small Russian model (2021, MIT), by the first piece. It has no ONNX of its own: the files are laid in
    // data/models/cointegrated/rubert-tiny2 by hand — config and tokenizer from cointegrated/rubert-tiny2,
    // onnx/model.onnx from fissium/rubert-tiny2 (its conversion)
    id: 'rubert-tiny2', title: 'rubert-tiny2 (cointegrated)', size: '≈120 МБ', query: '{}', passage: '{}',
    spec: { name: 'cointegrated/rubert-tiny2', dtype: 'fp32', pooling: 'cls' },
  },
  {
    // a small multilingual model of paraphrases (sentence-transformers, Apache 2.0), by the mean
    id: 'minilm', title: 'paraphrase-multilingual-MiniLM-L12-v2', size: '≈120 МБ', query: '{}', passage: '{}',
    spec: { name: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', pooling: 'mean' },
  },
];
/** A text marked as the model wants it. @param {string} template @param {string} text */
const marked = (template, text) => template.replace('{}', () => text);

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
  };

  /** Each model's vectors in memory (made when first asked; grown as more are worked out). @type {Map<string, Row[]>} */
  const loaded = new Map();
  /** The work in the background: one model at a time (the engine holds one). */
  /** The work in the background: one model at a time (the others asked for wait in `queue`, in turn). */
  const job = { model: /** @type {string | null} */ (null), queue: /** @type {string[]} */ ([]), stop: false, error: /** @type {Record<string, string>} */ ({}), rate: 0 };

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
      const { vectors, dims } = await engine.embed(m.spec, part.map((x) => marked(m.passage, x.text)));
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
    const { vectors } = await engine.embed(m.spec, [marked(m.query, text)]);
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
        models: MODELS.map((m) => ({
          id: m.id, title: m.title, size: m.size,
          downloaded: existsSync(`${where.models}/${m.spec.name}`),
          done: /** @type {{ n: number }} */ (q.done.get(m.id)).n, total,
          running: job.model === m.id, queued: job.queue.includes(m.id), rate: job.model === m.id ? job.rate : 0, error: job.error[m.id] ?? null,
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
      modelOf(id);
      if (!engine.installed()) throw new HttpError(503, 'Движок модели не установлен (server/features/lab/engine: npm install)');
      if (job.model === id) return void (job.stop = false); // (paused, its batch not yet done: goes on)
      if (!job.queue.includes(id)) job.queue.push(id);
      if (job.model) return; // (in turn, after the one at work)
      const next = async () => {
        while (job.queue.length) {
          const m = modelOf(/** @type {string} */ (job.queue.shift()));
          job.model = m.id;
          job.stop = false;
          job.rate = 0;
          delete job.error[m.id];
          try {
            await work(m);
          } catch (err) {
            job.error[m.id] = /** @type {Error} */ (err).message;
          } finally {
            job.model = null;
          }
          if (job.stop) break; // (paused: the queue waits)
        }
      };
      void next();
    },

    /** Stops the work after its batch; the models waiting in turn wait no more. */
    pause() {
      job.stop = true;
      job.queue = [];
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
      job.stop = true;
      engine.stop();
      lab.close();
    },
  };
}
