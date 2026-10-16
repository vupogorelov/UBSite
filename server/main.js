// @ts-check
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createRouter, createStatic, sendJson, HttpError, FileResponse, STREAM } from './http.js';
import { createAuth, readCookie, SESSION_COOKIE, viaLocalProxy, clientIp } from './auth.js';
import { createRateLimit } from './ratelimit.js';
import { createTagStore } from './tags.js';
import { createMarkTasks } from './marktasks.js';
import { startBackups, lastBackup } from './backup.js';
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
import { createBookVoice } from './bookvoice.js';
import { createTextSync } from './textsync.js';
import { createAnalytics } from './analytics.js';
import { registerAnalyticsRoutes } from './api/analytics.js';
import { registerIntegrationRoutes } from './api/integrations.js';
import { registerPronunciationRoutes } from './api/pronunciations.js';
import { registerPlaceRoutes } from './api/places.js';
import { createMailer } from './mail.js';
import { createAudio } from './audio.js';
import { registerAudioRoutes } from './api/audio.js';
import { registerAliasRoutes } from './api/aliases.js';
import { createOffline, registerOfflineRoutes } from './offline.js';
import { createOps, validOpId } from './ops.js';
import { createClientLog } from './clientlog.js';
import { registerLogRoutes } from './api/log.js';
import { existsSync } from 'node:fs';

// Settings kept out of the code — the mailbox letters go from (server/mail.js): deploy/mail.env, if it is there.
const ENV_FILE = process.env.UB_ENV_FILE ?? fileURLToPath(new URL('../deploy/mail.env', import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

// Behind Caddy the server stays on loopback; Caddy terminates HTTPS.
const HOST = process.env.UB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.UB_PORT ?? 4300);

const db = openDb();
// A quick look at the file's health on every start (a fraction of a second): damage is said loudly at
// once, not found weeks later by a failed query. The server starts all the same — reading the rest
// is better than nothing; the last good copy is in backups/.
{
  const verdict = /** @type {{ quick_check: string }[]} */ (db.prepare('PRAGMA quick_check').all()).map((r) => r.quick_check).join('; ');
  if (verdict !== 'ok') console.error(`${new Date().toISOString()} DATABASE DAMAGED (quick_check): ${verdict.slice(0, 500)}`);
}
const auth = createAuth(db);
const tags = createTagStore(db);
const translation = createTranslation(db);
const notifications = createNotifications(db, translation);
const glossary = createGlossary(db);
const chat = createChat(db, auth);
const markTasks = createMarkTasks(db);
chat.setMarkHook(markTasks.sync); // a marked message is the marker's task
markTasks.backfill(); // (once: the messages marked before)
const voice = createBookVoice(db, auth, chat);
chat.onDirect((key, _user, msg) => voice.answerSoon(key, msg)); // "Я и Книга": the Book answers
const textSync = createTextSync(db);
const router = createRouter();
const ops = createOps(db);
const mailer = createMailer();
registerAuthRoutes(router, db, auth, mailer);
registerAdminRoutes(router, db, auth, translation);
registerPublicRoutes(router, db, translation, notifications, glossary, chat);
registerChatRoutes(router, chat, voice);
registerIntegrationRoutes(router, textSync);
registerAnalyticsRoutes(router, createAnalytics(db));
registerGlossaryRoutes(router, db, glossary);
registerPronunciationRoutes(router, db);
registerExportRoutes(router, db, translation, createExport(db, translation));
registerNotificationRoutes(router, translation, notifications);
registerBookRoutes(router, db);
registerWorkspaceRoutes(router, db, auth);
registerSearchRoutes(router, auth);
registerAnnotationRoutes(router, db, tags, auth, chat);
registerCollectionRoutes(router, db, auth, chat);
registerTaskRoutes(router, db, auth, chat);
registerTagRoutes(router, db, tags, auth);
registerPlaceRoutes(router, db);
registerAudioRoutes(router, createAudio());
registerAliasRoutes(router, db);
registerOfflineRoutes(router, createOffline(router, db));
registerLogRoutes(router, createClientLog(db));
// Is it alive: the process answers and the database reads (503 — it does not); when the last copy was
// made. For restart.ps1 and an outside watcher; nothing personal in it.
const started = Date.now();
router.on('GET', '/api/health', () => {
  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    throw new HttpError(503, `База не отвечает: ${/** @type {Error} */ (err).message}`);
  }
  return { ok: true, uptimeMin: Math.round((Date.now() - started) / 60_000), backup: lastBackup() };
});
const serveStatic = createStatic(fileURLToPath(new URL('../web/dist', import.meta.url)));

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    // frame-src: the YooMoney fundraising widget on the "Поддержать проект" page
    "connect-src 'self'; frame-src 'self' https://yoomoney.ru; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/**
 * Read without signing in — a shared link to a paragraph or a quote opens for anyone: the contents,
 * a paper's text and the public layer's numbers (server/api/public.js). Everything else takes a session.
 */
const GUEST = /^\/api\/(health|toc|papers\/\d+|guest\/paper\/\d+)$/;
/** A request slower than this is written to the log (where the time goes, seen before anyone complains). */
const SLOW_MS = 500;
/** Those not signed in: a request budget per address (server/ratelimit.js). */
const guestLimit = createRateLimit();

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
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    // (the path only, never the query: a search's words stay private; a live stream is long by design)
    if (ms >= SLOW_MS && !url.pathname.endsWith('/stream')) console.warn(`${new Date().toISOString()} Slow: ${req.method} ${url.pathname} ${res.statusCode} ${ms} ms`);
  });
  try {
    if (url.pathname.startsWith('/api/')) {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
      const route = router.match(method, url.pathname);
      if (!route) throw new HttpError(404, 'Not found');
      const isPublic = url.pathname.startsWith('/api/auth/');
      const user = isPublic ? null : auth.userForToken(readCookie(req, SESSION_COOKIE));
      if (!user && !guestLimit.take(clientIp(req))) throw new HttpError(429, 'Слишком много запросов — подождите минуту');
      if (!isPublic && !user && !(method === 'GET' && GUEST.test(url.pathname))) throw new HttpError(401, 'Требуется вход');
      const ctx = { req, res, params: route.params, url, user: /** @type {any} */ (user) };
      const opId = req.headers['x-op-id'];
      if (method !== 'GET' && user && validOpId(opId)) {
        // a change from the device's queue: done once, however many times it is sent (server/ops.js)
        const a = await ops.once(user.id, opId, async () => {
          try {
            const data = await route.handler(ctx);
            if (data === STREAM || data instanceof FileResponse) throw new Error('A queued change must answer with JSON');
            return { status: 200, data, keep: true };
          } catch (err) {
            // refused for good (a mistake, no rights, not found) — kept; the server's own failure is not
            if (err instanceof HttpError && err.status < 500 && err.status !== 401) return { status: err.status, data: { error: err.message }, keep: true };
            throw err;
          }
        });
        return sendJson(req, res, a.status, a.data);
      }
      const data = await route.handler(ctx);
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
    if (status === 500) console.error(`${new Date().toISOString()} ${req.method} ${url.pathname}:`, err);
    if (!res.headersSent) sendJson(req, res, status, { error: status === 500 ? 'Internal error' : /** @type {Error} */ (err).message });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () =>
  console.log(`Urantia Papers Explorer: http://${HOST}:${PORT}${mailer.enabled ? '' : ' (почта не настроена: письма не отправляются)'}`),
);
startBackups(db);
// The Book speaks once a day at its hour (checked every minute; once a day at most).
setInterval(() => {
  try {
    voice.tick();
  } catch (err) {
    console.error('Book voice failed:', err);
  }
}, 60_000).unref();
// Integrations: the English text from its source, when it is on and its interval has passed.
setInterval(() => {
  textSync.tick().catch((err) => console.error('Text sync failed:', err));
}, 10 * 60_000).unref();
// Votes whose period ended are decided even if nobody opens them.
setInterval(() => {
  try {
    translation.sweep();
  } catch (err) {
    console.error('Voting sweep failed:', err);
  }
}, 10 * 60_000).unref();

// ---- Stopping ----
// Asked to stop (Ctrl+C in its window, systemd's SIGTERM): no new requests, the log of changes folded
// into the database file, the file closed — a clean stop. A failure nothing caught: the process's state
// is unknown, so it is written down and the process ends; deploy/start.ps1 (systemd on a server) starts
// it again in a few seconds.
let stopping = false;
/** @param {number} code */
function stop(code) {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections();
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (err) {
    console.error('Database not closed cleanly:', err);
  }
  process.exit(code);
}
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGBREAK'])) {
  process.on(signal, () => {
    console.log(`${new Date().toISOString()} ${signal}: stopping`);
    stop(0);
  });
}
for (const event of /** @type {const} */ (['uncaughtException', 'unhandledRejection'])) {
  process.on(event, (err) => {
    console.error(`${new Date().toISOString()} FATAL (${event}), restarting:`, err);
    stop(1);
  });
}
