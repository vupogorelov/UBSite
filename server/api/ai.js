// @ts-check
import { HttpError, STREAM, readJson } from '../http.js';
import { publicOrigin } from '../auth.js';

/**
 * The AI's connections (server/ai.js). The application's own — the administrator's to connect and let go: the
 * service's sign-in page is opened, it comes back here with a code, the key is kept on the server.
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../ai.js').createAi>} ai
 * @param {ReturnType<typeof import('../bookwords.js').createBookWords>} words «Я и Книга»'s own words: what a reader sees of them
 */
export function registerAiRoutes(router, ai, words) {
  // ---- a reader's own AI: connected by the same sign-in, used before the shared answers ----
  /** @param {import('../auth.js').User | null} user @returns {import('../auth.js').User} */
  const signedIn = (user) => {
    if (!user) throw new HttpError(401, 'Войдите');
    return user;
  };
  // { own: their AI or null, shared: { left, of } today or null }
  router.on('GET', '/api/ai/me', ({ user }) => words.state(signedIn(user).id));
  // { provider, back } — the address of the service's sign-in page (the browser goes there, then back to `back`)
  router.on('POST', '/api/ai/me/connect', async ({ req, user }) => {
    const u = signedIn(user);
    const b = /** @type {any} */ ((await readJson(req)) ?? {});
    return { url: ai.begin(`user:${u.id}`, String(b.provider ?? 'openrouter'), publicOrigin(req), String(b.back ?? '/')) };
  });
  router.on('DELETE', '/api/ai/me', ({ user }) => (ai.disconnect(`user:${signedIn(user).id}`), words.state(signedIn(user).id)));

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
    // (back where the sign-in began, with how it went: the app shows it — web/src/lib/ai.svelte.js)
    let back = ai.backOf(state);
    let how = 'connected';
    try {
      if (!code) throw new HttpError(400, 'Вход не завершён');
      back = await ai.finish(params.provider, code, state);
    } catch (err) {
      how = /** @type {Error} */ (err).message;
    }
    const to = `${back}${back.includes('?') ? '&' : '?'}ai=${encodeURIComponent(how)}`;
    res.writeHead(302, { Location: to }).end();
    return STREAM;
  });
}
