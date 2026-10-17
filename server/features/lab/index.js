// @ts-check
// The Laboratory (the page: web/src/features/lab/): an administrator's experiment with the search by
// meaning — models turn the book's paragraphs and a question into vectors; the closest paragraphs are
// compared with the word search. Nobody else sees it, and it holds nobody up: the model works in a
// process of its own at a lower priority (engine-client.js), its vectors are in a file of their own
// (data/lab.db). Gone with this folder, that file and data/models.
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
    r.on('POST', '/api/lab/models/:id/run', ({ params, user }) => (requireAdmin(user), open().run(params.id), open().status()));
    r.on('POST', '/api/lab/pause', ({ user }) => (requireAdmin(user), open().pause(), open().status()));
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
    r.on('DELETE', '/api/lab/questions/:id', ({ params, user }) => (requireAdmin(user), open().removeQuestion(Number(params.id)), open().status()));
  },
};
