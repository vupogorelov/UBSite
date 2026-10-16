// @ts-check
// Chat API: the chat list, messages (pages of older ones), posting with replies and @mentions,
// reactions, read marks, "печатает…", channels (kept by coordinators) and the live event stream.
import { HttpError, readJson, STREAM } from '../http.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {ReturnType<typeof import('../chat.js').createChat>} chat
 * @param {ReturnType<typeof import('../bookvoice.js').createBookVoice>} voice
 */
export function registerChatRoutes(router, chat, voice) {
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
  // { keys: [chat key, …] } — the user's pinned chats in order (up to 10); pin, unpin and reorder send the whole list
  router.on('PUT', '/api/chat/pinned', async ({ req, user }) => chat.setPinned(user, (await body(req)).keys));
  router.on('GET', '/api/chat/unread', ({ user }) => chat.unreadTotal(user));
  // ?q=<prefix>&key=<chat> — with a members-only chat, its members only
  router.on('GET', '/api/chat/users', ({ url, user }) => chat.users(url.searchParams.get('q') ?? '', user, url.searchParams.get('key')));

  router.on('GET', '/api/chat/c/:key', ({ params, user }) => chat.info(decodeURIComponent(params.key), user));
  // ?before=<message id> — the page of older messages
  router.on('GET', '/api/chat/c/:key/messages', ({ params, url, user }) => {
    const before = url.searchParams.get('before');
    return chat.page(decodeURIComponent(params.key), user, before ? Number(before) : undefined);
  });
  // ?q=<words>&mark=take|work|done — the search in one conversation
  router.on('GET', '/api/chat/c/:key/search', ({ params, url, user }) =>
    chat.search(decodeURIComponent(params.key), user, url.searchParams.get('q') ?? '', url.searchParams.get('mark') || null));
  // { body, replyTo?, writtenAt? } — writtenAt: written without a network, sent later
  router.on('POST', '/api/chat/c/:key/messages', async ({ req, params, user }) => {
    const b = await body(req);
    return chat.post(decodeURIComponent(params.key), user, { body: b.body, replyTo: b.replyTo, writtenAt: b.writtenAt });
  });
  // { upTo: message id }
  router.on('POST', '/api/chat/c/:key/read', async ({ req, params, user }) => {
    chat.markRead(decodeURIComponent(params.key), user, Number((await body(req)).upTo) || 0);
    return { ok: true };
  });
  // { messageId } — pins it (instead of the pinned one); { messageId: null } — unpins
  router.on('PUT', '/api/chat/c/:key/pin', async ({ req, params, user }) =>
    chat.pin(decodeURIComponent(params.key), user, (await body(req)).messageId));
  router.on('POST', '/api/chat/c/:key/typing', ({ params, user }) => {
    chat.typing(decodeURIComponent(params.key), user);
    return { ok: true };
  });

  // { muted } — the chat's news is (not) counted for the user
  router.on('PUT', '/api/chat/c/:key/mute', async ({ req, params, user }) =>
    chat.mute(decodeURIComponent(params.key), user, (await body(req)).muted === true));

  // The Book's voice (administrators): its state, "say it now", { paused }
  /** @param {import('../auth.js').User} user */
  const requireAdmin = (user) => {
    if (!user.isAdmin) throw new HttpError(403, 'Голосом Книги управляет администратор');
  };
  router.on('GET', '/api/chat/voice', ({ user }) => (requireAdmin(user), voice.status()));
  router.on('POST', '/api/chat/voice/post', ({ user }) => (requireAdmin(user), voice.post()));
  router.on('PUT', '/api/chat/voice', async ({ req, user }) => (requireAdmin(user), voice.pause((await body(req)).paused === true)));

  // { mark: 'take' | 'work' | 'done' | null } — an administrator's mark on a message
  router.on('PUT', '/api/chat/messages/:mid/mark', async ({ req, params, user }) => {
    const m = (await body(req)).mark;
    return chat.mark(Number(params.mid), user, m === undefined ? null : m);
  });
  // ?mark=take|work|done (none — all marked) — the chat list's filter
  router.on('GET', '/api/chat/marked', ({ url, user }) => chat.marked(user, url.searchParams.get('mark')));

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
