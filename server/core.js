// @ts-check
// The core the platform's features are built on (server/features.js lists them). It holds what more
// than one feature uses — the database, the router, the shared services (people, chats, the public
// layer, the glossary, tags, the Book's voice, mail) — and the four ways a feature joins in:
//   every(ms, name, fn)   a job done now and then (its failure written down, the next run still comes);
//   guest(re)             GET paths read without signing in (a shared link: server/main.js lets them in);
//   intercept(fn)         a look at a request before its route (an answer made in advance: offline.js);
//   on(event, fn)/emit()  a word between features ("bookChanged": the book's text changed).
// A feature is { name, setup(core) }: it registers its routes and the rest, it imports nothing of the
// others but what the core gives.
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { createTagStore } from './tags.js';
import { createTranslation } from './translation.js';
import { createNotifications } from './notifications.js';
import { createGlossary } from './glossary.js';
import { createChat } from './chat.js';
import { createBookVoice } from './bookvoice.js';
import { createMailer } from './mail.js';

/** @typedef {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, path: string) => boolean} Interceptor */
/** @typedef {ReturnType<typeof createCore>} Core */
/** @typedef {{ name: string, setup: (core: Core) => void }} Feature */

/** @param {import('node:sqlite').DatabaseSync} db */
export function createCore(db) {
  const router = createRouter();
  const auth = createAuth(db);
  const translation = createTranslation(db);
  const chat = createChat(db, auth);

  /** @type {{ ms: number, name: string, fn: () => unknown }[]} */
  const jobs = [];
  /** @type {RegExp[]} */
  const guestPaths = [];
  /** @type {Interceptor[]} */
  const interceptors = [];
  /** @type {Map<string, (() => void)[]>} */
  const listeners = new Map();

  return {
    db,
    router,
    // ---- shared services ----
    auth,
    chat,
    translation,
    notifications: createNotifications(db, translation),
    glossary: createGlossary(db),
    tags: createTagStore(db),
    voice: createBookVoice(db, auth, chat),
    mailer: createMailer(),

    // ---- how a feature joins in ----
    /** A job every `ms` (from the start; the first after `ms`). @param {number} ms @param {string} name @param {() => unknown} fn */
    every(ms, name, fn) {
      jobs.push({ ms, name, fn });
    },
    /** GET paths read without signing in. @param {RegExp} re */
    guest(re) {
      guestPaths.push(re);
    },
    /** A look at a request before its route: true — answered. @param {Interceptor} fn */
    intercept(fn) {
      interceptors.push(fn);
    },
    /** @param {string} event @param {() => void} fn */
    on(event, fn) {
      (listeners.get(event) ?? listeners.set(event, []).get(event))?.push(fn);
    },
    /** @param {string} event */
    emit(event) {
      for (const fn of listeners.get(event) ?? []) fn();
    },

    // ---- for server/main.js ----
    /** @param {string} path */
    isGuestPath: (path) => guestPaths.some((re) => re.test(path)),
    /** @type {Interceptor} */
    intercepted: (req, res, path) => interceptors.some((fn) => fn(req, res, path)),
    /** Starts the jobs (a failure is written down; the next run still comes). */
    startJobs() {
      for (const j of jobs) {
        setInterval(async () => {
          try {
            await j.fn();
          } catch (err) {
            console.error(`${new Date().toISOString()} ${j.name} failed:`, err);
          }
        }, j.ms).unref();
      }
    },
  };
}
