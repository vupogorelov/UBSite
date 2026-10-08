// @ts-check
// Tag management by name, so that parent levels without their own row ("космология" for
// "космология/Хавона") can be renamed, moved or deleted like any other tag.
// Reading: any member; creating/coloring: editors; renaming, merging, deleting: owners.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import { normalizeTagName, tagKey } from '../tags.js';

const COLORS = new Set(['yellow', 'green', 'blue', 'pink', 'purple']);

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../tags.js').createTagStore>} tags
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 */
export function registerTagRoutes(router, db, tags, auth) {
  const q = {
    list: db.prepare(
      `SELECT t.name, t.color, t.description, count(at.annotation_id) AS count
       FROM tags t LEFT JOIN annotation_tags at ON at.tag_id = t.id
       WHERE t.workspace_id = ? GROUP BY t.id ORDER BY t.name_key`,
    ),
    style: db.prepare('UPDATE tags SET color = ?, description = ? WHERE workspace_id = ? AND name_key = ?'),
    get: db.prepare('SELECT color, description FROM tags WHERE workspace_id = ? AND name_key = ?'),
  };

  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});

  router.on('GET', '/api/workspaces/:id/tags', ({ params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'viewer');
    return q.list.all(ws);
  });

  // Creates the tag if needed and updates its color/description: { name, color?, description? }
  router.on('PUT', '/api/workspaces/:id/tags', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'editor');
    const b = await body(req);
    const name = normalizeTagName(b.name);
    tags.ensure(ws, name);
    const cur = /** @type {{ color: string | null, description: string | null }} */ (q.get.get(ws, tagKey(name)));
    let color = cur.color;
    if ('color' in b) {
      if (b.color !== null && (typeof b.color !== 'string' || !COLORS.has(b.color))) throw new HttpError(400, 'Неизвестный цвет');
      color = /** @type {string | null} */ (b.color);
    }
    let description = cur.description;
    if ('description' in b) {
      if (b.description !== null && typeof b.description !== 'string') throw new HttpError(400, 'Описание должно быть строкой');
      description = typeof b.description === 'string' ? b.description.trim().slice(0, 500) || null : null;
    }
    q.style.run(color, description, ws, tagKey(name));
    return { name, color, description };
  });

  // Rename / move / merge with the whole subtree: { from, to }
  router.on('POST', '/api/workspaces/:id/tags/rename', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    const b = await body(req);
    const from = normalizeTagName(b.from);
    const to = normalizeTagName(b.to);
    return transaction(db, () => tags.rename(ws, from, to));
  });

  // { name, subtree } — annotations keep everything else
  router.on('POST', '/api/workspaces/:id/tags/delete', async ({ req, params, user }) => {
    const ws = Number(params.id);
    auth.require(ws, user, 'owner');
    const b = await body(req);
    const deleted = transaction(db, () => tags.remove(ws, normalizeTagName(b.name), b.subtree === true));
    return { deleted };
  });
}
