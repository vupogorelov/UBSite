// @ts-check
// A task's tags come from two places: `#words` in its title and the tags added in its details (stored
// in `tasks.tags`). What the task has is both together. A tag: letters, digits, _ and -, levels with /
// (as the notes' tags); one tag whatever the case — kept in lower case.

/** `#tag` in a text: not inside a word (e-mail, "C#") and without the punctuation after it. */
const IN_TEXT = /(^|[^\p{L}\p{N}_#/-])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

/** A tag as typed ("#Фикс", " фикс ") → its form ("фикс"), or null if it is not a tag. @param {string} raw */
export function normTag(raw) {
  const t = raw.trim().replace(/^#/, '').toLowerCase();
  return /^[\p{L}\p{N}_-]+(\/[\p{L}\p{N}_-]+)*$/u.test(t) && t.length <= 60 ? t : null;
}

/** The tags written in a title, in order, without repeats. @param {string} title */
export function titleTags(title) {
  return [...new Set([...title.matchAll(IN_TEXT)].map((m) => m[2].toLowerCase()))];
}

/** All the task's tags: the title's first, then the added ones. @param {{ title: string, tags: string[] }} task */
export function taskTags(task) {
  const added = task.tags.map((t) => normTag(t)).filter((t) => t !== null);
  return [...new Set([...titleTags(task.title), ...added])];
}

/**
 * The title without a tag (any case), the spaces around it tidied. @param {string} title @param {string} tag
 * @returns {string}
 */
export function stripTag(title, tag) {
  return title
    .replace(IN_TEXT, (all, before, t) => (t.toLowerCase() === tag ? before : all))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The title as text and tags, to draw the tags in place (and make them filters).
 * @param {string} title @returns {{ tag: string | null, text: string }[]}
 */
export function titleParts(title) {
  /** @type {{ tag: string | null, text: string }[]} */
  const out = [];
  let at = 0;
  for (const m of title.matchAll(IN_TEXT)) {
    const start = m.index + m[1].length;
    if (start > at) out.push({ tag: null, text: title.slice(at, start) });
    out.push({ tag: m[2].toLowerCase(), text: `#${m[2]}` });
    at = start + m[2].length + 1;
  }
  if (at < title.length) out.push({ tag: null, text: title.slice(at) });
  return out;
}
