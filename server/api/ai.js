// @ts-check
import { HttpError, STREAM, readJson } from '../http.js';
import { publicOrigin } from '../auth.js';

/**
 * The AI's connections (server/ai.js). The application's own — the administrator's to connect and let go: the
 * service's sign-in page is opened, it comes back here with a code, the key is kept on the server.
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../ai.js').createAi>} ai
 */
export function registerAiRoutes(router, ai) {
  /** @param {import('../auth.js').User | null} user */
  const requireAdmin = (user) => {
    if (!user?.isAdmin) throw new HttpError(403, 'Только для администратора');
  };

  router.on('GET', '/api/ai/app', ({ user }) => (requireAdmin(user), ai.status('app')));
  // { provider, back } — the address of the service's sign-in page (the browser goes there)
  router.on('POST', '/api/ai/app/connect', async ({ req, user }) => {
    requireAdmin(user);
    const b = /** @type {any} */ ((await readJson(req)) ?? {});
    return { url: ai.begin('app', String(b.provider ?? ''), publicOrigin(req), String(b.back ?? '/lab')) };
  });
  router.on('DELETE', '/api/ai/app', ({ user }) => (requireAdmin(user), ai.disconnect('app'), null));

  // the way back from the service's sign-in (a page the browser opens): the key kept, then the page it began on
  router.on('GET', '/api/ai/callback/:provider', async ({ res, url, params }) => {
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    let to;
    try {
      if (!code) throw new HttpError(400, 'Вход не завершён');
      const back = await ai.finish(params.provider, code, state);
      to = `${back}${back.includes('?') ? '&' : '?'}ai=connected`;
    } catch (err) {
      to = `/lab?ai=${encodeURIComponent(/** @type {Error} */ (err).message)}`;
    }
    res.writeHead(302, { Location: to }).end();
    return STREAM;
  });
}
