// @ts-check
// The dictionary of the book (the page: web/src/features/dictionary/; the data: store.js). Everyone reads
// the published articles — a guest by a link too; the coordinators write, publish and keep them.
// Read without a network: the published articles are in the book's copy on the device.
import { HttpError, readJson } from '../../http.js';
import { createDictionary, isCoordinator } from './store.js';

/** @param {import('../../auth.js').User | null} user */
const requireCoordinator = (user) => {
  if (!isCoordinator(user)) throw new HttpError(403, 'Словарь ведут координаторы');
  return /** @type {import('../../auth.js').User} */ (user);
};
/** @param {import('node:http').IncomingMessage} req */
const body = async (req) => /** @type {Record<string, any>} */ ((await readJson(req)) ?? {});
/** A coordinator asking for the drafts too (?drafts=1); otherwise the public answer. @param {URL} url @param {import('../../auth.js').User | null} user */
const withDrafts = (url, user) => url.searchParams.get('drafts') === '1' && isCoordinator(user);
/** @param {Record<string, string>} params */
const idOf = (params) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Статьи нет в словаре');
  return id;
};

/** @type {import('../../core.js').Feature} */
export default {
  name: 'dictionary',
  setup(core) {
    const dict = createDictionary(core.db, core.glossary, core.terms);
    const r = core.router;
    /**
     * A change: done, then the book's copy on the devices is told — it takes it at its next look.
     * @template T @param {(ctx: import('../../http.js').Ctx) => Promise<T> | T} fn
     */
    const change = (fn) => async (/** @type {import('../../http.js').Ctx} */ ctx) => {
      const out = await fn(ctx);
      core.emit('offlineChanged');
      return out;
    };
    // (the named routes before /api/dict/:id)
    r.on('GET', '/api/dict', ({ url, user }) => dict.list(withDrafts(url, user)));
    r.on('GET', '/api/dict/candidates', ({ user }) => (requireCoordinator(user), dict.candidates()));
    // ?text=…&lang=ru|en — the article of selected words ("Что это?"); null — none
    r.on('GET', '/api/dict/lookup', ({ url, user }) => dict.lookup(url.searchParams.get('text') ?? '', url.searchParams.get('lang') === 'en' ? 'en' : 'ru', user));
    r.on('GET', '/api/dict/:id', ({ params, url, user }) => dict.get(idOf(params), withDrafts(url, user)));
    r.on('GET', '/api/dict/:id/hints', ({ params, user }) => dict.hints(idOf(params), requireCoordinator(user)));
    r.on('GET', '/api/dict/:id/discussion', ({ params, user }) => dict.discussion(idOf(params), user));
    // { nameRu, nameEn?, kind?, glossaryIds? }
    r.on('POST', '/api/dict', change(async ({ req, user }) => ({ id: dict.create(await body(req), requireCoordinator(user)) })));
    // { kind?, nameRu?, nameEn?, briefRu?, briefEn?, bodyRu?, bodyEn?, status? }
    r.on('PATCH', '/api/dict/:id', change(async ({ req, params, user }) => {
      const id = idOf(params);
      dict.update(id, await body(req), requireCoordinator(user));
      return dict.get(id, true);
    }));
    r.on('DELETE', '/api/dict/:id', change(({ params, user }) => (dict.remove(idOf(params), requireCoordinator(user)), { ok: true })));
    // { glossaryIds } · { places: [{ ref, note }] } · { links: [{ id, kind }] }
    r.on('PUT', '/api/dict/:id/names', change(async ({ req, params, user }) => {
      const id = idOf(params);
      dict.setNames(id, (await body(req)).glossaryIds, requireCoordinator(user));
      return dict.get(id, true);
    }));
    r.on('PUT', '/api/dict/:id/places', change(async ({ req, params, user }) => {
      const id = idOf(params);
      dict.setPlaces(id, (await body(req)).places, requireCoordinator(user));
      return dict.get(id, true);
    }));
    r.on('PUT', '/api/dict/:id/links', change(async ({ req, params, user }) => {
      const id = idOf(params);
      dict.setLinks(id, (await body(req)).links, requireCoordinator(user));
      return dict.get(id, true);
    }));

    // an article's discussion: a chat "dict:12" (server/chat.js)
    core.chat.kind('dict', dict.chat);

    core.guest(/^\/api\/dict(\/\d+|\/lookup|\/\d+\/discussion)?$/);
    core.offline(dict.offlineUrls);
    core.on('bookChanged', dict.forget);
  },
};
