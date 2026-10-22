// @ts-check
// The Book's voice (VISION.md: the Book is a participant). Once a day the Book posts a paragraph of its
// own in the "Голос Книги" channel; the post goes into the channel's discussion (the general chat) as
// well, where people talk about it. For now a paragraph is picked at random (a whole one of a readable
// length, never twice); later a coordinators' collection of quotes, and the Book's own words through AI.
// The post keeps only the place in the book (the anchor) — readers see it in their own language.
import { HttpError } from './http.js';
import { tokenize, setStemAliases } from '../shared/search/text.js';

/** When it speaks: the hour (Moscow time, UTC+3, no summer time). */
const HOUR = 9;
const ZONE_HOURS = 3;
/** A paragraph that reads as a quote: not a fragment, not a page. */
const MIN = 200;
const MAX = 900;
/** How many paragraphs answer a question in "Я и Книга". */
const ANSWERS = 3;
const NOTHING = 'Такой информации не нашлось. Спросите иначе — другими словами или о понятии из книги.';
/** «Я и Книга»'s conversation: a pause longer than this begins it anew; so many last questions (and the answers) go with a question; from so many paragraphs at most an answer is made (the found and the last answer's). */
const PAUSE = 30 * 60_000;
const HISTORY = 4;
const FROM = 6;
/** How long the Book's own words are waited for (a free remote model writes in ≈10–80 s; busy — the list again). */
const WRITE_WITHIN = Number(process.env.UB_WRITE_WITHIN_MS ?? 150_000);
/** The words of a question that say nothing about its subject. */
const STOP = new Set(
  ('кто что как где когда зачем почему какой какая какое какие каков такой такая такое такие это этот эта эти ' +
    'есть быть был была были ли же бы не ни и а но или да нет для при про над под без из от до по на в во с со к ко у о об ' +
    'мне меня мой моя мои вы вас ваш он она они его её их нам нас мы ты тебя твой себя свой ' +
    'расскажи скажи объясни говорит говорится сказано написано книга книге книги урантия урантии можно нужно ' +
    'значит означает такое всё все весь вся очень тоже также еще ещё уже только просто ' +
    'what who whom whose how why where when which the and are was were does did can could would should ' +
    'about tell explain say says said book urantia there this that these those with from into for not ' +
    'after before happen happens happened mean means meaning become becomes has have had will shall being').split(' '),
);

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('./auth.js').createAuth>} auth
 * @param {ReturnType<typeof import('./chat.js').createChat>} chat
 */
export function createBookVoice(db, auth, chat) {
  // The Book as a participant: created once, the first time the server starts with this module.
  db.prepare("INSERT OR IGNORE INTO users (username, username_key, display_name, is_agent) VALUES ('urantiabook', 'urantiabook', 'Книга Урантии', 1)").run();
  const q = {
    book: db.prepare("SELECT id FROM users WHERE is_agent = 1 AND username_key = 'urantiabook'"),
    channel: db.prepare('SELECT id, discussion FROM channels WHERE voice = 1 AND archived = 0 ORDER BY id LIMIT 1'),
    pick: db.prepare(`
      SELECT ref, plain_ru AS text FROM paragraphs
      WHERE length(plain_ru) BETWEEN ${MIN} AND ${MAX}
        AND ref NOT IN (SELECT anchor_ref FROM public_messages WHERE ref = :key AND anchor_ref IS NOT NULL)
      ORDER BY random() LIMIT 1`),
    get: db.prepare('SELECT value FROM meta WHERE key = ?'),
    set: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  };
  /** @param {string} key */
  const meta = (key) => /** @type {{ value: string } | undefined} */ (q.get.get(key))?.value ?? null;

  /** The Book as a user (it writes through the same chat as people). */
  function bookUser() {
    const row = /** @type {{ id: number } | undefined} */ (q.book.get());
    const user = row && auth.userById(row.id);
    if (!user) throw new HttpError(500, 'Участник «Книга» не найден');
    return user;
  }

  /** The Moscow day and hour of a moment. @param {number} now */
  function local(now) {
    const d = new Date(now + ZONE_HOURS * 3_600_000);
    return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }

  /**
   * Posts a paragraph now: in the channel and, as the start of its discussion, in the general chat.
   * @returns {{ channelId: number, discussionId: number | null, ref: string }}
   */
  function post() {
    const ch = /** @type {{ id: number, discussion: string | null } | undefined} */ (q.channel.get());
    if (!ch) throw new HttpError(404, 'Канал «Голос Книги» не найден');
    const key = `chan:${ch.id}`;
    const p = /** @type {{ ref: string, text: string } | undefined} */ (q.pick.get({ key }));
    if (!p) throw new HttpError(409, 'Все подходящие абзацы уже прозвучали');
    const book = bookUser();
    const anchor = { ref: p.ref, lang: null, start: null, end: null };
    const inChannel = chat.post(key, book, { body: p.text, anchor });
    let discussionId = null;
    if (ch.discussion) {
      discussionId = chat.post(ch.discussion, book, { body: p.text, anchor }).id;
      chat.link(inChannel.id, discussionId);
      chat.changed(inChannel.id); // open screens learn the way to the discussion
    }
    return { channelId: inChannel.id, discussionId, ref: p.ref };
  }

  // ---- "Я и Книга": the Book answers with its own words ----
  // Until AI joins, the answer is the paragraphs that speak of the question most (FTS5's bm25 over the
  // stems of the Russian text): the Book quotes itself, and every answer can be checked in the book.
  const aliases = meta('ru_stem_aliases');
  if (aliases) setStemAliases(new Map(JSON.parse(aliases)));
  const relevant = db.prepare(`
    SELECT p.ref, p.plain_ru AS text FROM search_fts JOIN paragraphs p ON p.seq = search_fts.rowid
    WHERE search_fts MATCH ? ORDER BY rank LIMIT ?`);

  /**
   * The paragraphs that speak of a question most, by its words (the Book's answer; the Laboratory compares
   * it with the search by meaning). @param {string} text @param {number} [limit]
   * @returns {{ ref: string, text: string }[]}
   */
  function find(text, limit = ANSWERS) {
    // the question's language chooses the text to look in: English words — the English original
    const words = tokenize(text).filter((t) => t.script === 'ru' || t.script === 'en');
    const lang = words.filter((t) => t.script === 'en').length > words.length / 2 ? 'en' : 'ru';
    const stems = [...new Set(words.filter((t) => t.script === lang && t.norm.length > 2 && !STOP.has(t.norm)).map((t) => t.stem))];
    if (!stems.length) return [];
    try {
      return /** @type {any[]} */ (relevant.all(`${lang}_stem : (${stems.map((s) => `"${s.replaceAll('"', '')}"`).join(' OR ')})`, limit));
    } catch {
      return [];
    }
  }

  /**
   * Another way to find the answer (the Laboratory's search by meaning, for whom it is tried): the refs it
   * found, or null — not this one's, or not able now (the words then, as always).
   * @typedef {(text: string, ownerId: number, limit: number) => Promise<string[] | null>} Finder
   */
  /** @type {Finder | null} */
  let finder = null;
  /**
   * The answer in words (the remote AI, server/bookwords.js): written from the paragraphs found, each thought with its
   * paragraph's number, the conversation so far before it (`history`) — or null (no AI for this reader now: the
   * paragraphs alone then, as always).
   * @typedef {{ role: 'user' | 'assistant', content: string }} Turn
   * @typedef {(question: string, refs: string[], ownerId: number, history: Turn[]) => Promise<string | null>} Writer
   */
  /** @type {Writer | null} */
  let writer = null;
  const paragraphText = db.prepare('SELECT ref, plain_ru AS text FROM paragraphs WHERE ref = ?');
  const talk = {
    // the conversation before a question, newest first
    before: db.prepare(`SELECT m.id, m.kind, m.body, m.created_at AS at, m.anchor_ref AS ref, u.is_agent AS agent, b.refs
      FROM public_messages m JOIN users u ON u.id = m.author_id LEFT JOIN book_answers b ON b.message_id = m.id
      WHERE m.ref = ? AND m.id < ? AND m.hidden_at IS NULL ORDER BY m.id DESC LIMIT 60`),
    keep: db.prepare('INSERT OR REPLACE INTO book_answers (message_id, refs) VALUES (?, ?)'),
  };

  /**
   * The conversation a question goes on (its context): back to «Новая тема» or a pause of over half an hour — the
   * last questions and the Book's words to them (`history`, oldest first), the question before this one, the
   * paragraphs the Book's last answer was made from (its words' — or the paragraphs it answered with).
   * @param {string} key @param {{ id: number, created_at?: string }} question
   */
  function context(key, question) {
    const rows = /** @type {any[]} */ (talk.before.all(key, question.id));
    /** @type {Turn[]} */
    const history = [];
    /** @type {string[]} */
    let lastRefs = [];
    let previous = '';
    let later = Date.now(); // (the Book answers as soon as asked)
    /** @type {string[]} an answer of paragraphs alone: theirs, gathered back to its question */
    let pieces = [];
    for (const r of rows) {
      const at = Date.parse(`${String(r.at).replace(' ', 'T')}Z`);
      if (r.kind === 'event' || later - at > PAUSE) break;
      later = at;
      if (r.agent) {
        if (r.ref) pieces.unshift(r.ref);
        else if (r.kind === 'message') {
          history.unshift({ role: 'assistant', content: r.body });
          if (!lastRefs.length && r.refs) lastRefs = JSON.parse(r.refs);
        }
        continue;
      }
      if (r.kind !== 'message') continue;
      // a question: the paragraphs it was answered with (no words) — in the talk as their numbers
      if (pieces.length) {
        history.unshift({ role: 'assistant', content: `Абзацы: ${pieces.join(', ')}` });
        if (!lastRefs.length) lastRefs = pieces;
        pieces = [];
      }
      history.unshift({ role: 'user', content: r.body });
      if (!previous) previous = r.body;
      if (history.filter((t) => t.role === 'user').length >= HISTORY) break;
    }
    while (history[0]?.role === 'assistant') history.shift(); // (an answer whose question is before the context)
    return { history, previous, lastRefs };
  }

  /**
   * The words for the answer, while «Книга печатает…» stays on (the model writes for seconds); none — in time
   * or at all — the paragraphs answer alone.
   * @param {string} key @param {string} question @param {string[]} refs @param {number} owner @param {Turn[]} history
   */
  async function written(key, question, refs, owner, history) {
    if (!writer) return null;
    const book = bookUser();
    const typing = setInterval(() => chat.typing(key, book), 4000);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let late;
    try {
      /** @type {Promise<null>} */
      const timeout = new Promise((resolve) => (late = setTimeout(() => resolve(null), WRITE_WITHIN)));
      return await Promise.race([writer(question, refs, owner, history), timeout]);
    } catch (err) {
      console.error('The Book could not answer in its words, the paragraphs do:', err);
      return null;
    } finally {
      clearInterval(typing);
      clearTimeout(late);
    }
  }

  /**
   * Answers a question in one's "Я и Книга": up to three paragraphs, the first as a reply to it; or
   * says it found nothing. @param {string} key @param {{ id: number, body: string }} question
   * @returns {Promise<string[]>} the refs it answered with
   */
  async function answer(key, question) {
    const book = bookUser();
    const owner = Number(key.split(':')[1]);
    // the conversation it goes on: a follow-up («уточни…», «а что это значит?») is searched for with the question
    // before it, and answered from the last answer's paragraphs too, the talk so far before it
    const ctx = context(key, question);
    /** The paragraphs that speak of a text most: by meaning (the Laboratory's model), else by the words. @param {string} text */
    const search = async (text) => {
      /** @type {string[] | null} */
      let refs = null;
      try {
        refs = finder ? await finder(text, owner, ANSWERS) : null;
      } catch (err) {
        console.error('The other search could not answer, the words do:', err);
      }
      return refs
        ? refs.map((ref) => /** @type {{ ref: string, text: string } | undefined} */ (paragraphText.get(ref))).filter((p) => !!p).map((p) => /** @type {{ ref: string, text: string }} */ (p))
        : find(text);
    };
    // the question alone (what the paragraphs answer it with, no AI); with the one before it (a follow-up's subject)
    const found = await search(question.body);
    const withBefore = ctx.previous ? await search(`${ctx.previous}\n${question.body}`) : [];
    // its own words, as the reply — from the paragraphs found now, with the question before it, and the last answer's
    // (up to six; nothing on it there — the model says so); their numbers in it open each in the book (checked in
    // one tap). No AI now: the paragraphs found for the question, as quotes
    // (the last answer's first: a follow-up — «подробнее про второе» — is about them, whatever its own words find)
    const from = [...new Set([...ctx.lastRefs, ...withBefore.map((p) => p.ref), ...found.map((p) => p.ref)])].slice(0, FROM);
    if (!from.length) {
      chat.post(key, book, { body: NOTHING, replyTo: question.id });
      return [];
    }
    const words = await written(key, question.body, from, owner, ctx.history);
    if (words) {
      const msg = chat.post(key, book, { body: words, replyTo: question.id });
      talk.keep.run(msg.id, JSON.stringify(from));
      return from;
    }
    if (!found.length) {
      chat.post(key, book, { body: NOTHING, replyTo: question.id });
      return [];
    }
    found.forEach((p, i) => chat.post(key, book, { body: p.text, anchor: { ref: p.ref }, replyTo: i === 0 ? question.id : null }));
    return found.map((p) => p.ref);
  }

  /** «Новая тема» in one's «Я и Книга»: the next question begins a conversation anew. @param {string} key */
  function newTopic(key) {
    return chat.notice(key, bookUser(), 'Новая тема');
  }

  return {
    post,
    answer,
    find,
    newTopic,

    /** Another way to find the answer (the Laboratory's): see `finder`. @param {Finder | null} fn */
    useFinder(fn) {
      finder = fn;
    },
    /** The answer in the Book's own words (the Laboratory's): see `writer`. @param {Writer | null} fn */
    useWriter(fn) {
      writer = fn;
    },

    /** Live: "Книга Урантии печатает…", then the answer. @param {string} key @param {{ id: number, body: string }} question */
    answerSoon(key, question) {
      chat.typing(key, bookUser());
      setTimeout(() => {
        answer(key, question).catch((err) => console.error('The Book could not answer:', err));
      }, 900).unref();
    },

    /** Once a minute: at the hour, if not yet today and not paused, the Book speaks. @param {number} [now] */
    tick(now = Date.now()) {
      if (meta('voice.paused') === '1') return null;
      const { day, hour } = local(now);
      if (hour < HOUR || meta('voice.day') === day) return null;
      q.set.run('voice.day', day); // first: a failing post is not retried every minute
      return post();
    },

    /** @param {boolean} paused */
    pause(paused) {
      q.set.run('voice.paused', paused ? '1' : '0');
      return this.status();
    },

    /** For the channel's administrator controls. */
    status() {
      return { paused: meta('voice.paused') === '1', lastDay: meta('voice.day'), hour: HOUR };
    },
  };
}
