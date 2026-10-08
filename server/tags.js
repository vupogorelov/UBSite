// @ts-check
// Tags: hierarchical names ("космология/Хавона"), unique per workspace case-insensitively.
// A tag row may be missing for a parent level — the tree is derived from names.
import { HttpError } from './http.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */

const SEGMENT = /^[\p{L}\p{N}_-]+$/u;
const MAX_LENGTH = 100;
const MAX_DEPTH = 6;
/** #tag inside comment text (same rule as the web markup). */
const HASHTAG = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

/** Canonical display name: no "#", trimmed segments; throws on invalid input. @param {unknown} raw */
export function normalizeTagName(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'Имя тега должно быть строкой');
  const name = raw.trim().replace(/^#/, '').split('/').map((s) => s.trim()).join('/');
  const parts = name.split('/');
  if (!name || parts.some((s) => !SEGMENT.test(s))) {
    throw new HttpError(400, `Недопустимый тег «${raw}»: буквы, цифры, _ и -, уровни через /`);
  }
  if (name.length > MAX_LENGTH || parts.length > MAX_DEPTH) throw new HttpError(400, `Слишком длинный тег «${raw}»`);
  return name;
}

export const tagKey = (/** @type {string} */ name) => name.toLowerCase();

/** Hashtags found in a comment, normalized; invalid ones are skipped. @param {string} text */
export function hashtagsIn(text) {
  const out = [];
  for (const m of text.matchAll(HASHTAG)) {
    try {
      out.push(normalizeTagName(m[2].replace(/[/-]+$/, '')));
    } catch {
      // not a tag after all ("#" followed by punctuation only)
    }
  }
  return out;
}

/** @param {DatabaseSync} db */
export function createTagStore(db) {
  const q = {
    byKey: db.prepare('SELECT id, name FROM tags WHERE workspace_id = ? AND name_key = ?'),
    insert: db.prepare('INSERT INTO tags (workspace_id, name, name_key) VALUES (?, ?, ?) RETURNING id, name'),
    link: db.prepare('INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) VALUES (?, ?)'),
    unlinkAll: db.prepare('DELETE FROM annotation_tags WHERE annotation_id = ?'),
    namesFor: db.prepare(
      `SELECT at.annotation_id AS annotationId, t.name FROM annotation_tags at JOIN tags t ON t.id = at.tag_id
       WHERE t.workspace_id = ? ORDER BY t.name_key`,
    ),
    namesForOne: db.prepare(
      'SELECT t.name FROM annotation_tags at JOIN tags t ON t.id = at.tag_id WHERE at.annotation_id = ? ORDER BY t.name_key',
    ),
    // Prefix match without LIKE: tag names may contain "_", a LIKE wildcard.
    subtree: db.prepare(
      `SELECT id, name, name_key AS key, color, description FROM tags
       WHERE workspace_id = :ws AND (name_key = :key OR substr(name_key, 1, length(:key) + 1) = :key || '/')`,
    ),
    rename: db.prepare('UPDATE tags SET name = ?, name_key = ? WHERE id = ?'),
    moveLinks: db.prepare('INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) SELECT annotation_id, ? FROM annotation_tags WHERE tag_id = ?'),
    remove: db.prepare('DELETE FROM tags WHERE id = ?'),
    inheritStyle: db.prepare('UPDATE tags SET color = coalesce(color, ?), description = coalesce(description, ?) WHERE id = ?'),
    refsWithTag: db.prepare(
      `SELECT DISTINCT a.ref FROM annotations a
       JOIN annotation_tags at ON at.annotation_id = a.id JOIN tags t ON t.id = at.tag_id
       WHERE a.workspace_id = :ws AND (t.name_key = :key OR substr(t.name_key, 1, length(:key) + 1) = :key || '/')`,
    ),
  };

  /** Tag id for a name, created on first use. @param {number} ws @param {string} name */
  function ensure(ws, name) {
    const row = /** @type {{ id: number } | undefined} */ (q.byKey.get(ws, tagKey(name)));
    return row ? row.id : /** @type {{ id: number }} */ (q.insert.get(ws, name, tagKey(name))).id;
  }

  return {
    ensure,

    /** Replaces the annotation's tags. @param {number} ws @param {number} annotationId @param {string[]} names */
    set(ws, annotationId, names) {
      q.unlinkAll.run(annotationId);
      for (const n of names) q.link.run(annotationId, ensure(ws, n));
    },

    /** @param {number} ws @param {number} annotationId @param {string[]} names */
    add(ws, annotationId, names) {
      for (const n of names) q.link.run(annotationId, ensure(ws, n));
    },

    /** annotation id → tag names, for a whole workspace. @param {number} ws */
    namesByAnnotation(ws) {
      const rows = /** @type {{ annotationId: number, name: string }[]} */ (q.namesFor.all(ws));
      return Map.groupBy(rows, (r) => r.annotationId);
    },

    /** @param {number} annotationId */
    namesOf(annotationId) {
      return /** @type {{ name: string }[]} */ (q.namesForOne.all(annotationId)).map((r) => r.name);
    },

    /**
     * Renames or moves a tag together with its subtree. A target that already exists absorbs
     * the moved tag (merge). Returns how many tags were renamed and merged.
     * @param {number} ws @param {string} from @param {string} to
     */
    rename(ws, from, to) {
      const fromKey = tagKey(from);
      const toKey = tagKey(to);
      if (toKey.startsWith(fromKey + '/')) throw new HttpError(400, 'Нельзя перенести тег внутрь самого себя');
      const affected = /** @type {{ id: number, name: string, key: string, color: string | null, description: string | null }[]} */ (
        q.subtree.all({ ws, key: fromKey })
      );
      if (!affected.length) throw new HttpError(404, `Тег «${from}» не найден`);
      let renamed = 0;
      let merged = 0;
      for (const t of affected) {
        const target = to + t.name.slice(from.length);
        const existing = /** @type {{ id: number } | undefined} */ (q.byKey.get(ws, tagKey(target)));
        if (existing && existing.id !== t.id) {
          q.moveLinks.run(existing.id, t.id);
          q.inheritStyle.run(t.color, t.description, existing.id);
          q.remove.run(t.id);
          merged++;
        } else {
          q.rename.run(target, tagKey(target), t.id);
          renamed++;
        }
      }
      return { renamed, merged };
    },

    /** Deletes a tag (and optionally its subtree); annotations stay. @param {number} ws @param {string} name @param {boolean} subtree */
    remove(ws, name, subtree) {
      const key = tagKey(name);
      const rows = /** @type {{ id: number, key: string }[]} */ (q.subtree.all({ ws, key }));
      const doomed = subtree ? rows : rows.filter((r) => r.key === key);
      for (const r of doomed) q.remove.run(r.id);
      return doomed.length;
    },

    /** Paragraph refs carrying the tag or any tag below it. @param {number} ws @param {string} name */
    refsWith(ws, name) {
      return new Set(/** @type {{ ref: string }[]} */ (q.refsWithTag.all({ ws, key: tagKey(name) })).map((r) => r.ref));
    },
  };
}
