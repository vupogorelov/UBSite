// @ts-check
// The dictionary of the book: articles on persons, beings, places, concepts, events. An article's names
// are the glossary's entries (dict_names) — by them its places in the text are found, in both languages,
// as the reader lights the pairs of terms (server/terms.js); a coordinator writes its short and full
// description, chooses its main places and relates it to other articles. A draft is the coordinators'.
//
// The places of every term in the whole book are worked out once in the background (a paper at a time:
// the requests are answered in between) and again when the glossary or the book's text changes.
import { HttpError } from '../../http.js';
import { transaction } from '../../db.js';
import { termMatchers, findTerms } from '../../terms.js';
import { normalizeWord } from '../../../shared/search/text.js';

export const KINDS = /** @type {const} */ (['person', 'being', 'place', 'concept', 'event']);
const LINKS = /** @type {const} */ (['part', 'belongs', 'related']);
/** Text fields an article has, and their longest. */
const TEXTS = /** @type {const} */ ({ nameRu: 200, nameEn: 200, briefRu: 600, briefEn: 600, bodyRu: 20000, bodyEn: 20000 });
const COLUMN = /** @type {const} */ ({ nameRu: 'name_ru', nameEn: 'name_en', briefRu: 'brief_ru', briefEn: 'brief_en', bodyRu: 'body_ru', bodyEn: 'body_en' });

/** @typedef {import('../../auth.js').User} User */
/** @typedef {{ paragraphs: Set<string> }} Places */

/** @param {User | null} user */
export const isCoordinator = (user) => !!user && (user.isCoordinator || user.isAdmin);
/** Changes are the coordinators' — checked here too, not by the route alone. @param {User | null} user */
const writer = (user) => {
  if (!isCoordinator(user)) throw new HttpError(403, 'Словарь ведут координаторы');
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../../glossary.js').createGlossary>} glossary
 * @param {ReturnType<typeof import('../../terms.js').createTermIndex>} terms
 */
export function createDictionary(db, glossary, terms) {
  const ARTICLE = `SELECT id, kind, name_ru AS nameRu, name_en AS nameEn, brief_ru AS briefRu, brief_en AS briefEn,
      body_ru AS bodyRu, body_en AS bodyEn, status, updated_at AS updatedAt FROM dict_articles`;
  const q = {
    all: db.prepare(`${ARTICLE} ORDER BY name_ru COLLATE NOCASE`),
    one: db.prepare(`${ARTICLE} WHERE id = ?`),
    names: db.prepare('SELECT n.article_id AS articleId, g.id, g.ru, g.en FROM dict_names n JOIN glossary g ON g.id = n.glossary_id ORDER BY g.ru'),
    namesOf: db.prepare('SELECT g.id, g.ru, g.en FROM dict_names n JOIN glossary g ON g.id = n.glossary_id WHERE n.article_id = ? ORDER BY g.ru'),
    places: db.prepare(`SELECT p.ref, p.note, pa.plain_ru AS ru, pa.plain_en AS en, pp.title_ru AS paperTitle
      FROM dict_places p JOIN paragraphs pa ON pa.ref = p.ref JOIN papers pp ON pp.id = pa.paper_id WHERE p.article_id = ? ORDER BY p.pos`),
    links: db.prepare(`SELECT l.kind, a.id, a.name_ru AS nameRu, a.name_en AS nameEn, a.status FROM dict_links l
      JOIN dict_articles a ON a.id = l.to_id WHERE l.from_id = ? ORDER BY a.name_ru`),
    papers: db.prepare('SELECT id, title_ru AS titleRu, title_en AS titleEn FROM papers ORDER BY id'),
    seq: db.prepare('SELECT ref, seq FROM paragraphs'),
    paragraph: db.prepare('SELECT ref, plain_ru AS ru, plain_en AS en FROM paragraphs WHERE ref = ?'),
    exists: db.prepare('SELECT 1 FROM paragraphs WHERE ref = ?'),
    insert: db.prepare('INSERT INTO dict_articles (kind, name_ru, name_en, created_by, updated_by) VALUES (?, ?, ?, ?, ?) RETURNING id'),
    remove: db.prepare('DELETE FROM dict_articles WHERE id = ?'),
    touch: db.prepare("UPDATE dict_articles SET updated_by = ?, updated_at = datetime('now') WHERE id = ?"),
    clearNames: db.prepare('DELETE FROM dict_names WHERE article_id = ?'),
    addName: db.prepare('INSERT INTO dict_names (article_id, glossary_id) VALUES (?, ?)'),
    nameOwner: db.prepare('SELECT article_id AS articleId FROM dict_names WHERE glossary_id = ?'),
    clearPlaces: db.prepare('DELETE FROM dict_places WHERE article_id = ?'),
    addPlace: db.prepare('INSERT INTO dict_places (article_id, ref, note, pos) VALUES (?, ?, ?, ?)'),
    clearLinks: db.prepare('DELETE FROM dict_links WHERE from_id = ?'),
    addLink: db.prepare('INSERT INTO dict_links (from_id, to_id, kind) VALUES (?, ?, ?)'),
    messages: db.prepare("SELECT count(*) AS n FROM public_messages WHERE ref = ? AND kind = 'message' AND hidden_at IS NULL"),
  };

  // ---- Where each term stands in the book (made in the background) ----
  /** @type {Map<number, Places> | null} glossary id → the paragraphs it stands in */
  let index = null;
  let version = -1;
  /** @type {Promise<Map<number, Places>> | null} */
  let building = null;
  /** The paragraphs' order in the book (ref → seq). @type {Map<string, number>} */
  const order = new Map(/** @type {{ ref: string, seq: number }[]} */ (q.seq.all()).map((r) => [r.ref, r.seq]));

  async function build() {
    /** @type {Map<number, Places>} */
    const out = new Map();
    for (const p of /** @type {{ id: number }[]} */ (q.papers.all())) {
      await new Promise((r) => setImmediate(r)); // (a paper at a time: other requests are answered in between)
      const r = terms.paper(p.id);
      for (const [ref, x] of Object.entries(r.paras)) {
        for (const list of [x.ru, x.en]) {
          for (let i = 2; i < list.length; i += 3) {
            const places = out.get(list[i]) ?? out.set(list[i], { paragraphs: new Set() }).get(list[i]);
            places?.paragraphs.add(ref);
          }
        }
      }
    }
    return out;
  }
  /** The index, made anew when the glossary has changed (or when told the book did). */
  function placesIndex() {
    if (index && version === glossary.version()) return Promise.resolve(index);
    if (!building) {
      const v = glossary.version();
      building = build().then((m) => ((index = m), (version = v), m)).finally(() => (building = null));
    }
    return building;
  }
  // made at the start, so the first reader does not wait
  setTimeout(() => void placesIndex().catch((err) => console.error('Dictionary places failed:', err)), 3000).unref();

  /** The paragraphs of an article's names, in the book's order. @param {Map<number, Places>} ix @param {number[]} glossaryIds */
  const paragraphsOf = (ix, glossaryIds) => {
    /** @type {Set<string>} */
    const refs = new Set();
    for (const id of glossaryIds) for (const ref of ix.get(id)?.paragraphs ?? []) refs.add(ref);
    return [...refs].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  };

  /** @param {number} id @param {User | null} user */
  function article(id, user) {
    const a = /** @type {any} */ (q.one.get(id));
    if (!a || (a.status !== 'published' && !isCoordinator(user))) throw new HttpError(404, 'Статьи нет в словаре');
    return a;
  }

  /** @param {Record<string, unknown>} b */
  const kindOf = (b) => {
    if (b.kind === undefined) return undefined;
    if (!KINDS.includes(/** @type {any} */ (b.kind))) throw new HttpError(400, `Вид статьи: ${KINDS.join(', ')}`);
    return /** @type {string} */ (b.kind);
  };
  /** @param {unknown} v @param {string} key */
  const textOf = (v, key) => {
    if (typeof v !== 'string') throw new HttpError(400, `${key}: ожидается текст`);
    const max = TEXTS[/** @type {keyof typeof TEXTS} */ (key)];
    if (v.length > max) throw new HttpError(400, `${key}: длиннее ${max} символов`);
    return v.trim();
  };

  /** Names from the glossary: each in one article at most. @param {number} articleId @param {unknown} ids */
  function setNamesIn(articleId, ids) {
    if (!Array.isArray(ids) || ids.length > 30 || !ids.every((x) => Number.isInteger(x))) throw new HttpError(400, 'Имена: номера записей глоссария');
    for (const g of /** @type {number[]} */ (ids)) {
      const owner = /** @type {{ articleId: number } | undefined} */ (q.nameOwner.get(g));
      if (owner && owner.articleId !== articleId) throw new HttpError(409, 'Это имя уже в другой статье');
      if (!glossary.list().some((t) => t.id === g)) throw new HttpError(400, `Нет такой записи глоссария: ${g}`);
    }
    q.clearNames.run(articleId);
    for (const g of new Set(/** @type {number[]} */ (ids))) q.addName.run(articleId, g);
  }

  return {
    /**
     * The articles with how many paragraphs name them: the published ones — the same answer for everyone
     * (the book's copy on the devices holds it as it is); `drafts` — a coordinator's, with the drafts.
     * @param {boolean} drafts
     */
    async list(drafts) {
      const ix = await placesIndex();
      const names = Map.groupBy(/** @type {any[]} */ (q.names.all()), (n) => n.articleId);
      return /** @type {any[]} */ (q.all.all())
        .filter((a) => a.status === 'published' || drafts)
        .map(({ bodyRu, bodyEn, ...a }) => {
          const ids = (names.get(a.id) ?? []).map((n) => n.id);
          // `names`: its glossary entries — by them the reader marks the article's words in the text
          return { ...a, names: ids, paragraphs: paragraphsOf(ix, ids).length };
        });
    },

    /**
     * An article whole: its names, its main places with their text, related articles, every paragraph
     * that names it (by paper) and the first of them. A published one — the same for everyone; `drafts`
     * (a coordinator's): a draft too, and the related drafts.
     * @param {number} id @param {boolean} drafts
     */
    async get(id, drafts) {
      const a = /** @type {any} */ (q.one.get(id));
      if (!a || (a.status !== 'published' && !drafts)) throw new HttpError(404, 'Статьи нет в словаре');
      const ix = await placesIndex();
      const names = /** @type {{ id: number, ru: string, en: string }[]} */ (q.namesOf.all(id));
      const refs = paragraphsOf(ix, names.map((n) => n.id));
      const titles = new Map(/** @type {any[]} */ (q.papers.all()).map((p) => [p.id, p]));
      /** @type {{ paper: number, titleRu: string, titleEn: string, refs: string[] }[]} */
      const byPaper = [];
      for (const ref of refs) {
        const paper = Number(ref.split(':')[0]);
        if (byPaper.at(-1)?.paper !== paper) byPaper.push({ paper, titleRu: titles.get(paper)?.titleRu ?? '', titleEn: titles.get(paper)?.titleEn ?? '', refs: [] });
        byPaper.at(-1)?.refs.push(ref);
      }
      return {
        ...a,
        names,
        places: q.places.all(id),
        links: /** @type {any[]} */ (q.links.all(id)).filter((l) => l.status === 'published' || drafts).map(({ status, ...l }) => l),
        occurrences: { paragraphs: refs.length, papers: byPaper.length, first: refs[0] ?? null, byPaper },
      };
    },

    /** The glossary's names no article has yet, the most named first (a coordinator's start). */
    async candidates() {
      const ix = await placesIndex();
      const taken = new Set(/** @type {any[]} */ (q.names.all()).map((n) => n.id));
      return glossary.list()
        .filter((t) => !taken.has(t.id))
        .map((t) => ({ id: t.id, ru: t.ru, en: t.en, paragraphs: ix.get(t.id)?.paragraphs.size ?? 0 }))
        .filter((t) => t.paragraphs > 0)
        .sort((x, y) => y.paragraphs - x.paragraphs || x.ru.localeCompare(y.ru, 'ru'));
    },

    /**
     * The article of a word or words selected in the text ("Что это?"): by the glossary's terms in it,
     * failing that by an article's own name. null — none.
     * @param {string} text @param {'ru' | 'en'} lang @param {User | null} user
     */
    lookup(text, lang, user) {
      const t = text.trim().slice(0, 300);
      if (!t) return null;
      const names = /** @type {any[]} */ (q.names.all());
      const owner = new Map(names.map((n) => [n.id, n.articleId]));
      const visible = (/** @type {number} */ id) => {
        const a = /** @type {any} */ (q.one.get(id));
        return a && (a.status === 'published' || isCoordinator(user)) ? a : null;
      };
      // the longest term in the selection that an article has
      const found = findTerms(t, termMatchers(glossary.list())[lang]).sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
      for (const [, , gid] of found) {
        const a = owner.has(gid) ? visible(owner.get(gid)) : null;
        if (a) return { id: a.id, nameRu: a.nameRu, nameEn: a.nameEn, briefRu: a.briefRu, briefEn: a.briefEn, kind: a.kind };
      }
      // an article's own name, word for word
      const norm = (/** @type {string} */ s) => s.split(/\s+/).map((w) => normalizeWord(w).norm).join(' ');
      const want = norm(t);
      for (const a of /** @type {any[]} */ (q.all.all())) {
        if ((norm(a.nameRu) === want || (a.nameEn && norm(a.nameEn) === want)) && visible(a.id)) {
          return { id: a.id, nameRu: a.nameRu, nameEn: a.nameEn, briefRu: a.briefRu, briefEn: a.briefEn, kind: a.kind };
        }
      }
      return null;
    },

    /**
     * Places to consider as the main ones: the first mention, and the paragraphs that say what it is
     * ("X — это…", "X есть…", "X является…"), up to eight — the coordinator chooses.
     * @param {number} id @param {User} user
     */
    async hints(id, user) {
      writer(user);
      article(id, user);
      const ix = await placesIndex();
      const names = /** @type {{ id: number, ru: string, en: string }[]} */ (q.namesOf.all(id));
      const refs = paragraphsOf(ix, names.map((n) => n.id));
      const stems = names.map((n) => n.ru.toLowerCase().slice(0, Math.max(3, n.ru.length - 2)));
      const says = refs.filter((ref) => {
        const p = /** @type {{ ru: string } | undefined} */ (q.paragraph.get(ref));
        const text = p?.ru.toLowerCase() ?? '';
        return stems.some((s) => {
          const at = text.indexOf(s);
          return at >= 0 && /^[\p{L}]*\s*(—|–|-|есть\b|является\b|это\b|означает\b)/u.test(text.slice(at + s.length, at + s.length + 40));
        });
      });
      const picked = [...new Set([...(refs[0] ? [refs[0]] : []), ...says])].slice(0, 8);
      return picked.map((ref) => ({ ref, first: ref === refs[0], ...(/** @type {object} */ (q.paragraph.get(ref))) }));
    },

    /** @param {Record<string, unknown>} b @param {User} user */
    create(b, user) {
      writer(user);
      const nameRu = textOf(b.nameRu, 'nameRu');
      if (!nameRu) throw new HttpError(400, 'Нужно имя статьи');
      const kind = kindOf(b) ?? 'concept';
      return transaction(db, () => {
        const { id } = /** @type {{ id: number }} */ (q.insert.get(kind, nameRu, typeof b.nameEn === 'string' ? textOf(b.nameEn, 'nameEn') : '', user.id, user.id));
        if (b.glossaryIds !== undefined) setNamesIn(id, b.glossaryIds);
        return id;
      });
    },

    /** Fields: kind, names, short and full descriptions (ru, en), status. @param {number} id @param {Record<string, unknown>} b @param {User} user */
    update(id, b, user) {
      writer(user);
      article(id, user);
      /** @type {string[]} */
      const sets = [];
      /** @type {(string | number)[]} */
      const values = [];
      const kind = kindOf(b);
      if (kind) (sets.push('kind = ?'), values.push(kind));
      for (const key of /** @type {(keyof typeof COLUMN)[]} */ (Object.keys(COLUMN))) {
        if (b[key] === undefined) continue;
        const v = textOf(b[key], key);
        if (key === 'nameRu' && !v) throw new HttpError(400, 'Нужно имя статьи');
        sets.push(`${COLUMN[key]} = ?`);
        values.push(v);
      }
      if (b.status !== undefined) {
        if (b.status !== 'draft' && b.status !== 'published') throw new HttpError(400, 'Статус: draft или published');
        sets.push('status = ?');
        values.push(b.status);
      }
      if (sets.length) db.prepare(`UPDATE dict_articles SET ${sets.join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).run(...values, user.id, id);
    },

    /** @param {number} id @param {User} user */
    remove(id, user) {
      writer(user);
      article(id, user);
      q.remove.run(id);
    },

    /** @param {number} id @param {unknown} ids @param {User} user */
    setNames(id, ids, user) {
      writer(user);
      article(id, user);
      transaction(db, () => (setNamesIn(id, ids), q.touch.run(user.id, id)));
    },

    /** The main places, in order: [{ ref, note }]. @param {number} id @param {unknown} places @param {User} user */
    setPlaces(id, places, user) {
      writer(user);
      article(id, user);
      if (!Array.isArray(places) || places.length > 40) throw new HttpError(400, 'Главные места: список до 40');
      transaction(db, () => {
        q.clearPlaces.run(id);
        places.forEach((p, i) => {
          if (!p || typeof p.ref !== 'string' || !q.exists.get(p.ref)) throw new HttpError(400, `Нет такого абзаца: ${p?.ref}`);
          q.addPlace.run(id, p.ref, typeof p.note === 'string' ? p.note.trim().slice(0, 300) : '', i);
        });
        q.touch.run(user.id, id);
      });
    },

    /** Related articles: [{ id, kind }]. @param {number} id @param {unknown} links @param {User} user */
    setLinks(id, links, user) {
      writer(user);
      article(id, user);
      if (!Array.isArray(links) || links.length > 40) throw new HttpError(400, 'Связи: список до 40');
      transaction(db, () => {
        q.clearLinks.run(id);
        for (const l of links) {
          if (!l || !Number.isInteger(l.id) || l.id === id || !q.one.get(l.id)) throw new HttpError(400, `Нет такой статьи: ${l?.id}`);
          if (l.kind !== undefined && !LINKS.includes(l.kind)) throw new HttpError(400, `Связь: ${LINKS.join(', ')}`);
          q.addLink.run(id, l.id, l.kind ?? 'related');
        }
        q.touch.run(user.id, id);
      });
    },

    /**
     * An article's discussion — a chat of its own ("dict:12"), open as a paragraph's thread: to everyone
     * signed in, while the article is published (a draft — to the coordinators).
     * @type {import('../../chat.js').ChatKind}
     */
    chat: {
      access: (id, user) => void article(id, user),
      header: (id, user) => {
        const a = article(id, user);
        return { title: a.nameRu, subtitle: 'Статья словаря', link: `/d/${id}`, linkLabel: 'Открыть статью' };
      },
    },

    /** How many messages its discussion has. @param {number} id @param {User | null} user */
    discussion(id, user) {
      article(id, user);
      return { messages: /** @type {{ n: number }} */ (q.messages.get(`dict:${id}`)).n };
    },

    /** The published articles' addresses (the book's copy on a device: read without a network). */
    offlineUrls: () => ['/api/dict', ...(/** @type {any[]} */ (q.all.all())).filter((a) => a.status === 'published').map((a) => `/api/dict/${a.id}`)],

    /** The book's text changed: the places are found again. */
    forget() {
      index = null;
    },
  };
}
