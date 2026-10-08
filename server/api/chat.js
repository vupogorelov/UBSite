// @ts-check
// Chat API: the chat list, messages (pages of older ones), posting with replies and @mentions,
// reactions, read marks, "печатает…", channels (kept by coordinators) and the live event stream.
import { HttpError, readJson, STREAM } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../chat.js').createChat>} chat
 */
export function registerChatRoutes(router, chat) {
  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});
  /** @param {import('../auth.js').User} user */
  const requireCoordinator = (user) => {
    if (!user.isCoordinator && !user.isAdmin) throw new HttpError(403, 'Каналы ведут координаторы');
  };

  // Live events for this tab (Server-Sent Events).
  router.on('GET', '/api/chat/stream', ({ req, res, user }) => {
    chat.hub.subscribe(req, res, user.id);
    return STREAM;
  });

  router.on('GET', '/api/chat', ({ user }) => chat.list(user));
  router.on('GET', '/api/chat/unread', ({ user }) => chat.unreadTotal(user));
  router.on('GET', '/api/chat/users', ({ url }) => chat.users(url.searchParams.get('q') ?? ''));

  router.on('GET', '/api/chat/c/:key', ({ params, user }) => chat.info(decodeURIComponent(params.key), user));
  // ?before=<message id> — the page of older messages
  router.on('GET', '/api/chat/c/:key/messages', ({ params, url, user }) => {
    const before = url.searchParams.get('before');
    return chat.page(decodeURIComponent(params.key), user, before ? Number(before) : undefined);
  });
  // { body, replyTo? }
  router.on('POST', '/api/chat/c/:key/messages', async ({ req, params, user }) => {
    const b = await body(req);
    return chat.post(decodeURIComponent(params.key), user, { body: b.body, replyTo: b.replyTo });
  });
  // { upTo: message id }
  router.on('POST', '/api/chat/c/:key/read', async ({ req, params, user }) => {
    chat.markRead(decodeURIComponent(params.key), user, Number((await body(req)).upTo) || 0);
    return { ok: true };
  });
  router.on('POST', '/api/chat/c/:key/typing', ({ params, user }) => {
    chat.typing(decodeURIComponent(params.key), user);
    return { ok: true };
  });

  // { emoji } — toggles the user's reaction
  router.on('POST', '/api/chat/messages/:mid/react', async ({ req, params, user }) => ({
    reactions: chat.react(Number(params.mid), user, (await body(req)).emoji),
  }));

  router.on('POST', '/api/chat/channels', async ({ req, user }) => {
    requireCoordinator(user);
    return { id: chat.channels.create(await body(req), user) };
  });
  // { title?, description?, archived? }
  router.on('PATCH', '/api/chat/channels/:id', async ({ req, params, user }) => {
    requireCoordinator(user);
    chat.channels.update(Number(params.id), await body(req));
    return { ok: true };
  });
}
