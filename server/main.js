// @ts-check
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createRouter, createStatic, sendJson, HttpError, FileResponse, STREAM } from './http.js';
import { createAuth, readCookie, SESSION_COOKIE, viaLocalProxy } from './auth.js';
import { createTagStore } from './tags.js';
import { startBackups } from './backup.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerBookRoutes } from './api/book.js';
import { registerWorkspaceRoutes } from './api/workspaces.js';
import { registerSearchRoutes } from './api/search.js';
import { registerAnnotationRoutes } from './api/annotations.js';
import { registerTagRoutes } from './api/tags.js';
import { registerPublicRoutes } from './api/public.js';
import { registerNotificationRoutes } from './api/notifications.js';
import { createTranslation } from './translation.js';
import { createNotifications } from './notifications.js';
import { createGlossary } from './glossary.js';
import { registerGlossaryRoutes } from './api/glossary.js';
import { createExport } from './export.js';
import { registerExportRoutes } from './api/export.js';
import { registerCollectionRoutes } from './api/collections.js';
import { registerTaskRoutes } from './api/tasks.js';
import { createChat } from './chat.js';
import { registerChatRoutes } from './api/chat.js';
import { registerPronunciationRoutes } from './api/pronunciations.js';

// Behind Caddy the server stays on loopback; Caddy terminates HTTPS.
const HOST = process.env.UB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.UB_PORT ?? 4300);

const db = openDb();
const auth = createAuth(db);
const tags = createTagStore(db);
const translation = createTranslation(db);
const notifications = createNotifications(db, translation);
const glossary = createGlossary(db);
const chat = createChat(db, auth);
const router = createRouter();
registerAuthRoutes(router, db, auth);
registerAdminRoutes(router, db, auth, translation);
registerPublicRoutes(router, db, translation, notifications, glossary, chat);
registerChatRoutes(router, chat);
registerGlossaryRoutes(router, db, glossary);
registerPronunciationRoutes(router, db);
registerExportRoutes(router, db, translation, createExport(db, translation));
registerNotificationRoutes(router, translation, notifications);
registerBookRoutes(router, db);
registerWorkspaceRoutes(router, db, auth);
registerSearchRoutes(router, auth);
registerAnnotationRoutes(router, db, tags, auth);
registerCollectionRoutes(router, db, auth);
registerTaskRoutes(router, db, auth);
registerTagRoutes(router, db, tags, auth);
const serveStatic = createStatic(fileURLToPath(new URL('../web/dist', import.meta.url)));

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/** Browsers send Origin on cross-site writes; it must name this very host. @param {import('node:http').IncomingMessage} req */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = (viaLocalProxy(req) && req.headers['x-forwarded-host']) || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (url.pathname.startsWith('/api/')) {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
      const route = router.match(method, url.pathname);
      if (!route) throw new HttpError(404, 'Not found');
      const isPublic = url.pathname.startsWith('/api/auth/');
      const user = isPublic ? null : auth.userForToken(readCookie(req, SESSION_COOKIE));
      if (!isPublic && !user) throw new HttpError(401, 'Требуется вход');
      const data = await route.handler({ req, res, params: route.params, url, user: /** @type {any} */ (user) });
      if (data === STREAM) return;
      if (data instanceof FileResponse) data.send(res);
      else sendJson(req, res, 200, data);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url.pathname);
    } else {
      throw new HttpError(405, 'Method not allowed');
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(req, res, status, { error: status === 500 ? 'Internal error' : /** @type {Error} */ (err).message });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => console.log(`Urantian Docs Explorer: http://${HOST}:${PORT}`));
startBackups(db);
// Votes whose period ended are decided even if nobody opens them.
setInterval(() => {
  try {
    translation.sweep();
  } catch (err) {
    console.error('Voting sweep failed:', err);
  }
}, 10 * 60_000).unref();
