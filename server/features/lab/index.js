// @ts-check
// The Laboratory (the page: web/src/features/lab/): an administrator's experiment with the search by
// meaning — models turn the book's paragraphs and a question into vectors; the closest paragraphs are
// compared with the word search. Nobody else sees it, and it holds nobody up: the model works in a
// process of its own at a lower priority (engine-client.js), its vectors are in a file of their own
// (data/lab.db). The model chosen answers the platform's search by meaning and the hybrid one, for everyone
// (server/meaning.js). Gone with this folder, that file and data/models: the search is by the words then.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, readJson } from '../../http.js';
import { DEFAULT_DB_PATH } from '../../db.js';
import { createEngine } from './engine-client.js';
import { createLab } from './store.js';

const DATA = dirname(DEFAULT_DB_PATH);
/** The models: large and shared (a test's copy of the database uses them too) — always the project's data/models. */
const MODELS = process.env.UB_LAB_MODELS ?? fileURLToPath(new URL('../../../data/models', import.meta.url));

/** @param {import('../../auth.js').User | null} user */
const requireAdmin = (user) => {
  if (!user?.isAdmin) throw new HttpError(403, 'Только для администратора');
};

/** @type {import('../../core.js').Feature} */
export default {
  name: 'lab',
  setup(core) {
    /** @type {ReturnType<typeof createLab> | null} */
    let lab = null;
    // opened when the Laboratory is first looked at: a server never looked at keeps no file of it
    // (the vectors: beside the database)
    const open = () => (lab ??= createLab(core.db, createEngine(MODELS), { file: process.env.UB_LAB_DB ?? join(DATA, 'lab.db'), models: MODELS }));
    process.on('exit', () => lab?.close());

    const r = core.router;
    r.on('GET', '/api/lab', ({ user }) => (requireAdmin(user), open().status()));
    // the paragraphs left to judge, per question
    r.on('GET', '/api/lab/todo', ({ user }) => (requireAdmin(user), open().todo()));
    r.on('POST', '/api/lab/models/:id/run', ({ params, user }) => (requireAdmin(user), open().run(params.id), open().status()));
    r.on('POST', '/api/lab/models/:id/pause', ({ params, user }) => (requireAdmin(user), open().pause(params.id), open().status()));
    r.on('POST', '/api/lab/run-all', ({ user }) => (requireAdmin(user), open().runAll(), open().status()));
    r.on('POST', '/api/lab/pause', ({ user }) => (requireAdmin(user), open().pause(), open().status()));
    // { threads: 1–16, gpu, together } — how the vectors are worked out
    r.on('POST', '/api/lab/settings', async ({ req, user }) => {
      requireAdmin(user);
      open().configure(/** @type {any} */ ((await readJson(req)) ?? {}));
      return open().status();
    });
    // { text } — the closest paragraphs of each model, and of the word search
    r.on('POST', '/api/lab/ask', async ({ req, user }) => {
      requireAdmin(user);
      const b = /** @type {any} */ ((await readJson(req)) ?? {});
      return open().ask(String(b.text ?? ''), (text, limit) => core.voice.find(text, limit));
    });
    r.on('POST', '/api/lab/questions', async ({ req, user }) => {
      requireAdmin(user);
      open().addQuestion(/** @type {any} */ ((await readJson(req)) ?? {}).text);
      return open().status();
    });
    // { question, ref, good: true | false | null } — the paragraph answers the question, in every column
    r.on('POST', '/api/lab/judged', async ({ req, user }) => {
      requireAdmin(user);
      open().judge(/** @type {any} */ ((await readJson(req)) ?? {}));
      return open().status();
    });
    // ---- the Book's answers in its own words: the writing models answer the saved questions ----
    // { again } — every saved question (else those not answered yet)
    r.on('POST', '/api/lab/writers/:id/run', async ({ req, params, user }) => {
      requireAdmin(user);
      open().write(params.id, !!(/** @type {any} */ ((await readJson(req)) ?? {}).again));
      return open().status();
    });
    r.on('POST', '/api/lab/writers/pause', ({ user }) => (requireAdmin(user), open().pauseWriting(), open().status()));
    r.on('GET', '/api/lab/replies', ({ user }) => (requireAdmin(user), open().replies()));
    // { question, model, good: true | false | null }
    r.on('POST', '/api/lab/replies/judged', async ({ req, user }) => {
      requireAdmin(user);
      open().judgeReply(/** @type {any} */ ((await readJson(req)) ?? {}));
      return open().status();
    });
    r.on('DELETE', '/api/lab/questions/:id', ({ params, user }) => (requireAdmin(user), open().removeQuestion(Number(params.id)), open().status()));

    // ---- «Я и Книга» answered by the search by meaning (EmbeddingGemma) — an administrator's own conversation, to try it
    // in earnest; everyone else's Book answers by the words, as before (server/bookvoice.js) ----
    core.voice.useFinder(async (text, ownerId, limit) => {
      if (!core.auth.userById(ownerId)?.isAdmin) return null;
      return open().bookAnswer(text, limit);
    });
    // …and in its own words (the writing model), from the paragraphs found — an administrator's, as the above
    core.voice.useWriter(async (question, refs, ownerId) => {
      if (!core.auth.userById(ownerId)?.isAdmin) return null;
      return open().bookWrite(question, refs);
    });
    // ---- the search by meaning and the hybrid one, for everyone (the search's modes; server/meaning.js) ----
    core.meaning.use((text, mode, limit) => open().find(text, mode, limit, (t, l) => core.voice.find(t, l)));
    const q = {
      message: core.db.prepare(`SELECT m.id, m.ref AS chat, m.anchor_ref AS ref, u.is_agent AS agent
        FROM public_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`),
      // the question a Book's answer is to: the owner's last message before it
      question: core.db.prepare(`SELECT body FROM public_messages WHERE ref = ? AND id < ? AND author_id = ? AND kind = 'message'
        AND hidden_at IS NULL ORDER BY id DESC LIMIT 1`),
      answers: core.db.prepare(`SELECT m.id, m.anchor_ref AS ref FROM public_messages m JOIN users u ON u.id = m.author_id
        WHERE m.ref = ? AND u.is_agent = 1 AND m.anchor_ref IS NOT NULL ORDER BY m.id DESC LIMIT 300`),
    };
    /** A Book's answer in one's own «Я и Книга»: its paragraph and the question it answers. @param {number} id @param {number} userId */
    const bookAnswer = (id, userId) => {
      const m = /** @type {any} */ (q.message.get(id));
      if (!m || m.chat !== `dm:${userId}` || !m.agent || !m.ref) throw new HttpError(404, 'Это не ответ Книги в вашем чате');
      const question = /** @type {{ body: string } | undefined} */ (q.question.get(m.chat, id, userId))?.body;
      if (!question) throw new HttpError(404, 'Вопрос к этому ответу не найден');
      return { ref: /** @type {string} */ (m.ref), question };
    };
    // { id, good: true | false | null } — a Book's answer judged: its paragraph for its question (as in the Laboratory)
    r.on('POST', '/api/lab/book-judged', async ({ req, user }) => {
      requireAdmin(user);
      const b = /** @type {any} */ ((await readJson(req)) ?? {});
      const { ref, question } = bookAnswer(Number(b.id), /** @type {any} */ (user).id);
      open().judge({ question, ref, good: b.good });
      return { id: Number(b.id), good: b.good };
    });
    // the judgements of the Book's answers in one's «Я и Книга»: { [message id]: true | false }
    r.on('GET', '/api/lab/book-judged', ({ user }) => {
      requireAdmin(user);
      const uid = /** @type {any} */ (user).id;
      /** @type {Record<number, boolean>} */
      const out = {};
      for (const a of /** @type {{ id: number, ref: string }[]} */ (q.answers.all(`dm:${uid}`))) {
        const question = /** @type {{ body: string } | undefined} */ (q.question.get(`dm:${uid}`, a.id, uid))?.body;
        const j = question ? open().judgedFor(question, a.ref) : null;
        if (j !== null) out[a.id] = j;
      }
      return out;
    });
  },
};
