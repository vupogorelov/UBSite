// @ts-check
// Translation glossary and translation memory. Terms are matched by word stems, so the glossary
// entry "Настройщик Мысли" also finds "Настройщика Мысли", "Настройщиком Мысли".
// Checks only warn: a machine can misjudge context (quotations, wordplay); people decide.
import { HttpError } from './http.js';
import { tokenize } from './search/text.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/**
 * @typedef {{ id: number, en: string, ru: string, avoid: string[], note: string | null, updatedAt: string, updatedBy: string | null }} Term
 * @typedef {{ kind: 'lost' | 'avoid', termId: number, message: string }} Warning
 * @typedef {{ id: number, ref: string, original: string, text: string, status: string, exact: boolean }} MemoryHit
 */

const MAX = 300;

/** Stems of the words of a phrase. @param {string} text */
const stems = (text) => tokenize(text).map((t) => t.stem);

/**
 * Occurrences of a phrase (as stems) in a text (as tokens), as character ranges.
 * @param {import('./search/text.js').Token[]} tokens @param {string[]} phrase
 */
export function findPhrase(tokens, phrase) {
  /** @type {{ start: number, end: number }[]} */
  const out = [];
  if (!phrase.length) return out;
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    if (phrase.every((s, k) => tokens[i + k].stem === s)) {
      out.push({ start: tokens[i].start, end: tokens[i + phrase.length - 1].end });
      i += phrase.length - 1;
    }
  }
  return out;
}

/** @param {unknown} v @param {string} what */
function field(v, what) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${what}: пусто`);
  if (v.length > MAX) throw new HttpError(400, `${what}: длиннее ${MAX} символов`);
  return v.trim().replace(/\s+/g, ' ');
}
/** @param {unknown} v @returns {string[]} */
function variants(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  return [...new Set(list.filter((x) => typeof x === 'string').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 20);
}

/** @param {DatabaseSync} db */
export function createGlossary(db) {
  const q = {
    all: db.prepare(`
      SELECT g.id, g.en, g.ru, g.avoid, g.note, g.updated_at AS updatedAt, coalesce(u.display_name, u.username) AS updatedBy
      FROM glossary g LEFT JOIN users u ON u.id = g.updated_by ORDER BY lower(g.en)`),
    byEn: db.prepare('SELECT id FROM glossary WHERE lower(en) = lower(?)'),
    insert: db.prepare('INSERT INTO glossary (en, ru, avoid, note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'),
    update: db.prepare("UPDATE glossary SET en = ?, ru = ?, avoid = ?, note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?"),
    remove: db.prepare('DELETE FROM glossary WHERE id = ?'),
    one: db.prepare('SELECT id FROM glossary WHERE id = ?'),
    memory: db.prepare("SELECT id, ref, original, status FROM proposals WHERE status IN ('approved', 'voting')"),
    text: db.prepare('SELECT text FROM proposal_versions WHERE proposal_id = ? AND version = (SELECT version FROM proposals WHERE id = ?)'),
  };

  /** Terms with their stems, rebuilt after every change. @type {(Term & { enStems: string[], ruStems: string[], avoidStems: string[][] })[] | null} */
  let cache = null;
  function terms() {
    cache ??= /** @type {any[]} */ (q.all.all()).map((r) => {
      const avoid = r.avoid ? r.avoid.split('\n') : [];
      return { ...r, avoid, enStems: stems(r.en), ruStems: stems(r.ru), avoidStems: avoid.map(stems) };
    });
    return cache;
  }

  /** @param {Record<string, unknown>} b */
  function parse(b) {
    return { en: field(b.en, 'Английский термин'), ru: field(b.ru, 'Русский перевод'), avoid: variants(b.avoid), note: typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : null };
  }
  /** @param {string} en @param {number | null} self */
  function unique(en, self) {
    const row = /** @type {{ id: number } | undefined} */ (q.byEn.get(en));
    if (row && row.id !== self) throw new HttpError(409, `Термин «${en}» уже есть в глоссарии`);
  }

  return {
    /** @returns {Term[]} */
    list: () => terms().map(({ enStems, ruStems, avoidStems, ...t }) => t),

    /** @param {Record<string, unknown>} b @param {number} userId */
    create(b, userId) {
      const t = parse(b);
      unique(t.en, null);
      const { id } = /** @type {{ id: number }} */ (q.insert.get(t.en, t.ru, t.avoid.join('\n'), t.note, userId, userId));
      cache = null;
      return id;
    },

    /** @param {number} id @param {Record<string, unknown>} b @param {number} userId */
    update(id, b, userId) {
      if (!q.one.get(id)) throw new HttpError(404, 'Термин не найден');
      const t = parse(b);
      unique(t.en, id);
      q.update.run(t.en, t.ru, t.avoid.join('\n'), t.note, userId, id);
      cache = null;
    },

    /** @param {number} id */
    remove(id) {
      q.remove.run(id);
      cache = null;
    },

    /**
     * Glossary warnings for a variant of a fragment:
     * a required term of the original fragment disappeared; an undesirable variant is used.
     * @param {string} original @param {string} text
     * @returns {Warning[]}
     */
    check(original, text) {
      const before = tokenize(original);
      const after = tokenize(text);
      /** @type {Warning[]} */
      const out = [];
      for (const t of terms()) {
        const had = findPhrase(before, t.ruStems).length;
        if (had > findPhrase(after, t.ruStems).length) {
          out.push({ kind: 'lost', termId: t.id, message: `Пропал термин «${t.ru}» (${t.en}), который был в исходном фрагменте` });
        }
        t.avoidStems.forEach((a, i) => {
          if (findPhrase(after, a).length && !findPhrase(before, a).length) {
            out.push({ kind: 'avoid', termId: t.id, message: `«${t.avoid[i]}» — нежелательный вариант; по глоссарию: «${t.ru}» (${t.en})` });
          }
        });
      }
      return out;
    },

    /**
     * Terms relevant to a fragment: found in the Russian fragment (as the required or an undesirable
     * variant) or, in English, anywhere in the paragraph.
     * @param {string} original @param {string} en
     */
    termsFor(original, en) {
      const ru = tokenize(original);
      const enTokens = tokenize(en);
      return terms()
        .filter((t) => findPhrase(ru, t.ruStems).length || t.avoidStems.some((a) => findPhrase(ru, a).length) || findPhrase(enTokens, t.enStems).length)
        .map(({ enStems, ruStems, avoidStems, ...t }) => t);
    },

    /**
     * Translation memory: how the same wording was translated elsewhere (approved and under vote).
     * Exact matches (same words) first, then proposals whose original contains the fragment.
     * @param {string} original @param {number | null} exceptId
     * @returns {MemoryHit[]}
     */
    memory(original, exceptId = null) {
      const phrase = stems(original);
      if (!phrase.length) return [];
      const key = phrase.join(' ');
      /** @type {MemoryHit[]} */
      const hits = [];
      for (const p of /** @type {any[]} */ (q.memory.all())) {
        if (p.id === exceptId) continue;
        const other = stems(p.original);
        const exact = other.join(' ') === key;
        if (!exact && !(phrase.length <= other.length && findPhrase(tokenize(p.original), phrase).length)) continue;
        const v = /** @type {{ text: string } | undefined} */ (q.text.get(p.id, p.id));
        if (v) hits.push({ id: p.id, ref: p.ref, original: p.original, text: v.text, status: p.status, exact });
      }
      const rank = (/** @type {MemoryHit} */ h) => (h.exact ? 0 : 2) + (h.status === 'approved' ? 0 : 1);
      return hits.sort((a, b) => rank(a) - rank(b)).slice(0, 10);
    },
  };
}
