// @ts-check
// The platform's features, in the order their routes are registered. Each joins the core
// (server/core.js) by its setup: its routes, its jobs, the paths a guest may read, what it answers in
// advance, what it listens for. A new feature is a file of its own in this folder (as support.js), added here.
import { HttpError } from '../http.js';
import { registerAuthRoutes } from '../api/auth.js';
import { registerAdminRoutes } from '../api/admin.js';
import { registerPublicRoutes } from '../api/public.js';
import { registerChatRoutes } from '../api/chat.js';
import { createTextSync } from '../textsync.js';
import { registerIntegrationRoutes } from '../api/integrations.js';
import { createAnalytics } from '../analytics.js';
import { registerAnalyticsRoutes } from '../api/analytics.js';
import { registerGlossaryRoutes } from '../api/glossary.js';
import { registerPronunciationRoutes } from '../api/pronunciations.js';
import { createExport } from '../export.js';
import { registerExportRoutes } from '../api/export.js';
import { registerNotificationRoutes } from '../api/notifications.js';
import { registerBookRoutes } from '../api/book.js';
import { registerWorkspaceRoutes } from '../api/workspaces.js';
import { registerSearchRoutes } from '../api/search.js';
import { registerAiRoutes } from '../api/ai.js';
import { createBookWords } from '../bookwords.js';
import { registerAnnotationRoutes } from '../api/annotations.js';
import { registerCollectionRoutes } from '../api/collections.js';
import { createMarkTasks } from '../marktasks.js';
import { registerTaskRoutes } from '../api/tasks.js';
import { registerTagRoutes } from '../api/tags.js';
import { registerPlaceRoutes } from '../api/places.js';
import { createAudio } from '../audio.js';
import { registerAudioRoutes } from '../api/audio.js';
import { registerAliasRoutes } from '../api/aliases.js';
import { createOffline, registerOfflineRoutes, storedAnswers } from '../offline.js';
import { createClientLog } from '../clientlog.js';
import { registerLogRoutes } from '../api/log.js';
import { createLive } from '../live.js';
import { lastBackup } from '../backup.js';
import support from './support.js';
import dictionary from './dictionary/index.js';
import lab from './lab/index.js';
import whatsnew from './whatsnew.js';

const MINUTE = 60_000;

/** @type {import('../core.js').Feature[]} */
export const FEATURES = [
  { name: 'auth', setup: (c) => registerAuthRoutes(c.router, c.db, c.auth, c.mailer) },
  { name: 'admin', setup: (c) => registerAdminRoutes(c.router, c.db, c.auth, c.translation) },
  {
    // the public layer: paragraph threads and variants of translation (a guest sees their numbers)
    name: 'public',
    setup(c) {
      registerPublicRoutes(c.router, c.db, c.translation, c.notifications, c.glossary, c.chat);
      c.guest(/^\/api\/guest\/paper\/\d+$/);
      // votes whose period ended are decided even if nobody opens them
      c.every(10 * MINUTE, 'Voting sweep', () => c.translation.sweep());
    },
  },
  {
    name: 'chat',
    setup(c) {
      registerChatRoutes(c.router, c.chat, c.voice);
      c.chat.onDirect((key, _user, msg) => c.voice.answerSoon(key, msg)); // "Я и Книга": the Book answers
      // the Book speaks once a day at its hour (checked every minute; once a day at most)
      c.every(MINUTE, 'Book voice', () => c.voice.tick());
    },
  },
  {
    // the English text from its source; a change of the book's text is told to the others
    name: 'integrations',
    setup(c) {
      const textSync = createTextSync(c.db, { onChange: () => c.emit('bookChanged') });
      registerIntegrationRoutes(c.router, textSync);
      c.every(10 * MINUTE, 'Text sync', () => textSync.tick());
    },
  },
  { name: 'analytics', setup: (c) => registerAnalyticsRoutes(c.router, createAnalytics(c.db)) },
  { name: 'glossary', setup: (c) => registerGlossaryRoutes(c.router, c.db, c.glossary, c.terms) },
  { name: 'pronunciations', setup: (c) => registerPronunciationRoutes(c.router, c.db) },
  { name: 'export', setup: (c) => registerExportRoutes(c.router, c.db, c.translation, createExport(c.db, c.translation)) },
  { name: 'notifications', setup: (c) => registerNotificationRoutes(c.router, c.translation, c.notifications) },
  {
    // the book's text: open to a guest (a shared link); the contents read anew when the book changes
    name: 'book',
    setup(c) {
      const book = registerBookRoutes(c.router, c.db);
      c.guest(/^\/api\/(toc|papers\/\d+)$/);
      c.on('bookChanged', book.forget);
    },
  },
  { name: 'workspaces', setup: (c) => registerWorkspaceRoutes(c.router, c.db, c.auth) },
  { name: 'search', setup: (c) => registerSearchRoutes(c.router, c.auth, c.meaning) },
  {
    name: 'ai',
    setup(c) {
      // «Я и Книга» in the Book's own words: the reader's AI, else the application's shared answers of the day
      const words = createBookWords(c.db, c.ai);
      c.voice.useWriter((question, refs, ownerId) => words.write(question, refs, ownerId));
      registerAiRoutes(c.router, c.ai, words);
      // the way back from a sign-in may come in a browser not signed in here (the phone's own): its one-time
      // state is what admits it
      c.guest(/^\/api\/ai\/callback\/[a-z]+$/);
    },
  },
  { name: 'notes', setup: (c) => registerAnnotationRoutes(c.router, c.db, c.tags, c.auth, c.chat) },
  { name: 'collections', setup: (c) => registerCollectionRoutes(c.router, c.db, c.auth, c.chat) },
  {
    name: 'tasks',
    setup(c) {
      const markTasks = createMarkTasks(c.db);
      c.chat.setMarkHook(markTasks.sync); // a marked message is the marker's task
      markTasks.backfill(); // (once: the messages marked before)
      registerTaskRoutes(c.router, c.db, c.auth, c.chat);
    },
  },
  { name: 'tags', setup: (c) => registerTagRoutes(c.router, c.db, c.tags, c.auth) },
  { name: 'places', setup: (c) => registerPlaceRoutes(c.router, c.db) },
  { name: 'audio', setup: (c) => registerAudioRoutes(c.router, createAudio()) },
  { name: 'aliases', setup: (c) => registerAliasRoutes(c.router, c.db) },
  {
    // the book for reading without a network; its text served from the answers made for it
    name: 'offline',
    setup(c) {
      const offline = createOffline(c.router, c.db, c.offlineUrls); // (the features' own addresses too: core.offline)
      registerOfflineRoutes(c.router, offline);
      c.intercept(storedAnswers(offline));
      c.on('bookChanged', offline.invalidate);
      c.on('offlineChanged', offline.refresh); // (a feature's own part of the copy changed: core.offline)
    },
  },
  { name: 'log', setup: (c) => registerLogRoutes(c.router, createClientLog(c.db)) },
  {
    // notes and tasks changed: the open tabs concerned are told at once
    name: 'live',
    setup: (c) => void createLive(c.db, c.chat.hub, c.auth).start(),
  },
  support,
  dictionary,
  lab, // (the Laboratory: an administrator's experiment with the search by meaning)
  whatsnew, // («Что нового»: whatsnew.md)
  {
    // is it alive: the process answers and the database reads (503 — it does not); when the last copy
    // was made. For restart.ps1 and an outside watcher; nothing personal in it.
    name: 'health',
    setup(c) {
      const started = Date.now();
      c.guest(/^\/api\/health$/);
      c.router.on('GET', '/api/health', () => {
        try {
          c.db.prepare('SELECT 1').get();
        } catch (err) {
          throw new HttpError(503, `База не отвечает: ${/** @type {Error} */ (err).message}`);
        }
        return { ok: true, uptimeMin: Math.round((Date.now() - started) / 60_000), backup: lastBackup() };
      });
    },
  },
];
