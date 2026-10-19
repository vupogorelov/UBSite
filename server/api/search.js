// @ts-check
import { HttpError } from '../http.js';
import { createSearchClient } from '../search/client.js';

/** How many paragraphs a search by meaning (or the hybrid one) finds: the closest; further on — far from the question. */
const BY_MEANING = 50;
/** …asked of the model when the query has filters of place (a part, a paper): enough to keep as many in it. */
const DEEP = 3000;
/** The query's filters (часть:2, #тег) — for the words' core, not for the model: it is asked the question alone. */
const FILTERS = /(^|\s)(?:-?#\S+|\p{L}+:\S+)/gu;

/**
 * Search runs in a worker thread (see search/client.js). Tag filters use the notes of the
 * workspace given as ?ws=, which the user must be a member of. `mode`: words (the default), meaning — the
 * model's closest paragraphs, hybrid — the model's first, the words adding what it missed (server/meaning.js);
 * either of these two — its order kept, the query's filters of place applied, the hybrid's words marked.
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 * @param {ReturnType<typeof import('../meaning.js').createMeaning>} meaning
 */
export function registerSearchRoutes(router, auth, meaning) {
  const client = createSearchClient();

  /** @param {URL} url @param {import('../auth.js').User} user */
  const workspace = (url, user) => {
    const ws = Number(url.searchParams.get('ws'));
    auth.require(ws, user, 'viewer');
    return ws;
  };

  router.on('GET', '/api/search', async ({ url, user }) => {
    const ws = workspace(url, user);
    const text = url.searchParams.get('q') ?? '';
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const mode = url.searchParams.get('mode');
    if (mode !== 'meaning' && mode !== 'hybrid') return client.run({ op: 'search', text, offset, limit, ws });
    const question = text.replace(FILTERS, ' ').trim();
    if (!question) throw new HttpError(400, 'Задайте вопрос словами');
    if (question.length > 500) throw new HttpError(400, 'Вопрос — до 500 знаков');
    // (with filters of place: the closest of the whole book first, the first BY_MEANING of those in the place then)
    const refs = await meaning.find(question, mode, question === text.trim() ? BY_MEANING : DEEP);
    if (!refs) throw new HttpError(503, 'Поиск по смыслу сейчас недоступен');
    return client.run({ op: 'cards', text, refs, keep: BY_MEANING, offset, limit, mark: mode === 'hybrid', ws });
  });

  router.on('GET', '/api/search/highlights', ({ url, user }) => {
    const ws = workspace(url, user);
    const paper = Number(url.searchParams.get('paper'));
    if (!Number.isInteger(paper)) throw new HttpError(400, 'paper is required');
    return client.run({ op: 'highlights', text: url.searchParams.get('q') ?? '', paper, ws });
  });
}
