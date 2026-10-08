// @ts-check
import { HttpError } from '../http.js';
import { createSearchClient } from '../search/client.js';

/**
 * Search runs in a worker thread (see search/client.js). Tag filters use the notes of the
 * workspace given as ?ws=, which the user must be a member of.
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 */
export function registerSearchRoutes(router, auth) {
  const client = createSearchClient();

  /** @param {URL} url @param {import('../auth.js').User} user */
  const workspace = (url, user) => {
    const ws = Number(url.searchParams.get('ws'));
    auth.require(ws, user, 'viewer');
    return ws;
  };

  router.on('GET', '/api/search', ({ url, user }) => {
    const ws = workspace(url, user);
    const text = url.searchParams.get('q') ?? '';
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    return client.run({ op: 'search', text, offset, limit, ws });
  });

  router.on('GET', '/api/search/highlights', ({ url, user }) => {
    const ws = workspace(url, user);
    const paper = Number(url.searchParams.get('paper'));
    if (!Number.isInteger(paper)) throw new HttpError(400, 'paper is required');
    return client.run({ op: 'highlights', text: url.searchParams.get('q') ?? '', paper, ws });
  });
}
