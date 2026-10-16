// @ts-check
// Workspace tags, the tag tree and the tag selected as a "folder" in the notes tab.
import { api } from './api.js';
import { notes, loadPaperNotes } from './notes.svelte.js';
import { showToast } from './toast.svelte.js';

/** @typedef {import('./api.js').Tag} Tag */
/**
 * @typedef {{
 *   segment: string, path: string, key: string, tag: Tag | null,
 *   children: TagNode[], direct: number, total: number
 * }} TagNode
 */

export const tags = $state({
  /** @type {Tag[]} */ list: [],
  /** Key of the tag chosen as a folder in the notes tab; NO_TAG = notes without tags. @type {string | null} */
  filter: null,
});
export const NO_TAG = '\u0000none';

let loadedVersion = -1;

export async function loadTags(force = false) {
  if (!force && loadedVersion === notes.version) return;
  loadedVersion = notes.version;
  try {
    tags.list = await api.tags();
  } catch (err) {
    console.error('Tags not loaded:', err);
  }
}

export const tagKey = (/** @type {string} */ name) => name.toLowerCase();
/** Does `name` equal `key` or lie below it? */
export const inSubtree = (/** @type {string} */ name, /** @type {string} */ key) => {
  const k = tagKey(name);
  return k === key || k.startsWith(key + '/');
};

/**
 * Builds the tree from tag names (missing parent levels become virtual nodes).
 * `counts` gives notes per tag key; totals count each note once per subtree.
 * @param {Tag[]} list
 * @param {{ tags: string[] }[]} [items] notes used for counts; if omitted, tag.count is used
 * @returns {TagNode[]}
 */
export function buildTree(list, items) {
  /** @type {Map<string, TagNode>} */
  const byKey = new Map();
  /** @type {TagNode[]} */
  const roots = [];
  const node = (/** @type {string} */ path) => {
    const key = tagKey(path);
    let n = byKey.get(key);
    if (n) return n;
    const parts = path.split('/');
    n = { segment: parts.at(-1) ?? path, path, key, tag: null, children: [], direct: 0, total: 0 };
    byKey.set(key, n);
    if (parts.length > 1) node(parts.slice(0, -1).join('/')).children.push(n);
    else roots.push(n);
    return n;
  };
  for (const t of list) node(t.name).tag = t;

  if (items) {
    /** @type {Map<string, number>} */
    const totals = new Map();
    for (const it of items) {
      const seen = new Set();
      for (const name of it.tags) {
        const n = node(name);
        n.direct++;
        const parts = name.split('/');
        for (let i = 1; i <= parts.length; i++) seen.add(tagKey(parts.slice(0, i).join('/')));
      }
      for (const k of seen) totals.set(k, (totals.get(k) ?? 0) + 1);
    }
    for (const [k, v] of totals) (/** @type {TagNode} */ (byKey.get(k))).total = v;
  } else {
    const sum = (/** @type {TagNode} */ n) => {
      n.direct = n.tag?.count ?? 0;
      n.total = n.direct + n.children.reduce((s, c) => s + sum(c), 0);
      return n.total;
    };
    roots.forEach(sum);
  }
  const sort = (/** @type {TagNode[]} */ arr) => {
    arr.sort((a, b) => a.segment.localeCompare(b.segment, 'ru'));
    arr.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** @param {string} from @param {string} to */
export async function renameTag(from, to) {
  try {
    const r = await api.renameTag(from, to);
    showToast(r.merged ? `Объединено с #${to}` : `Переименовано в #${to}`);
    notes.version++; // notes of the open paper and lists must reload their tag names
    if (notes.paperId !== null) await loadPaperNotes(notes.paperId);
    await loadTags(true);
    return true;
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
    return false;
  }
}

/** @param {string} name @param {boolean} subtree */
export async function deleteTag(name, subtree) {
  try {
    const r = await api.deleteTag(name, subtree);
    showToast(`Удалено тегов: ${r.deleted}`);
    notes.version++;
    if (notes.paperId !== null) await loadPaperNotes(notes.paperId);
    if (tags.filter && inSubtree(tags.filter, tagKey(name))) tags.filter = null;
    await loadTags(true);
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
  }
}

/** @param {string} name @param {import('./api.js').NoteColor | null} color */
export async function setTagColor(name, color) {
  try {
    await api.putTag({ name, color });
    await loadTags(true);
  } catch (err) {
    showToast(/** @type {Error} */ (err).message);
  }
}

/** Color of a tag, inherited from the nearest colored ancestor. @param {string} name */
export function tagColor(name) {
  const parts = name.split('/');
  for (let i = parts.length; i > 0; i--) {
    const key = tagKey(parts.slice(0, i).join('/'));
    const t = tags.list.find((x) => tagKey(x.name) === key);
    if (t?.color) return t.color;
  }
  return null;
}

/** Client-side check matching the server rule. @param {string} raw @returns {string | null} */
export function cleanTagName(raw) {
  const name = raw.trim().replace(/^#/, '').split('/').map((s) => s.trim()).join('/');
  return /^[\p{L}\p{N}_-]+(\/[\p{L}\p{N}_-]+)*$/u.test(name) && name.length <= 100 ? name : null;
}
