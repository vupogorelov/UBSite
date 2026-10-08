// @ts-check
// A small Markdown renderer (no dependencies) for the "О приложении" page, GitHub-flavoured where it
// matters: # headings, paragraphs, **bold**, *italic*, `code`, [links](url), - / 1. lists (nested by
// indentation), > quotes, ``` code blocks, --- rules and | tables |. Everything is escaped first;
// only the produced tags are HTML.

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline markup of one line. `base`: where relative image paths point (as on GitHub, an image
 * "about/x.webp" sits next to the .md file).
 * @param {string} text @param {string} [base]
 */
export function inlineMd(text, base = '') {
  /** @type {string[]} */
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
      const url = /^(https?:)?\//i.test(src) ? src : /^[\w./-]+$/.test(src) ? base + src : '';
      return url ? `<img src="${url}" alt="${alt}" loading="lazy">` : '';
    })
    .replace(/(^|[^"])\[([^\]]+)\]\(([^)\s]+)\)/g, (_, pre, label, url) => {
      const safe = /^(https?:|mailto:|\/|#)/i.test(url) ? url : '#';
      const external = /^https?:/i.test(safe);
      return `${pre}<a href="${safe}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

/** @param {string} line */
const listItem = (line) => line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
/** @param {string} line */
const tableRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** @param {string} md @param {string} [base] where relative image paths point @returns {string} HTML */
export function renderMarkdown(md, base = '') {
  /** @param {string} t */
  const il = (t) => inlineMd(t, base);
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  /** @type {string[]} */ const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // ``` code block
    if (/^```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    // # heading
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (h) {
      out.push(`<h${h[1].length}>${il(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    // --- rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    // > quote (its content is Markdown too)
    if (/^>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), base)}</blockquote>`);
      continue;
    }
    // | table | with a | --- | line
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = tableRow(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(tableRow(lines[i]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${il(c)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${il(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      );
      continue;
    }
    // - list / 1. list, nested by indentation
    if (listItem(line)) {
      /** @type {{ indent: number, ordered: boolean }[]} */ const stack = [];
      let html = '';
      for (; i < lines.length; i++) {
        const m = listItem(lines[i]);
        if (!m) {
          // a continuation line of the item, or the end of the list
          if (lines[i].trim() && /^\s+/.test(lines[i])) {
            html += ' ' + il(lines[i].trim());
            continue;
          }
          break;
        }
        const indent = m[1].length;
        const ordered = /\d/.test(m[2]);
        while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${/** @type {any} */ (stack.pop()).ordered ? 'ol' : 'ul'}>`;
        if (!stack.length || indent > stack[stack.length - 1].indent) {
          stack.push({ indent, ordered });
          html += ordered ? '<ol>' : '<ul>';
        } else html += '</li>';
        html += `<li>${il(m[3])}`;
      }
      while (stack.length) html += `</li></${/** @type {any} */ (stack.pop()).ordered ? 'ol' : 'ul'}>`;
      out.push(html);
      continue;
    }
    // paragraph: until an empty line or another block; a line ending in "\" (or two spaces) breaks
    // the line there, as on GitHub
    const para = [line];
    for (i++; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*\|)/.test(lines[i]) && !listItem(lines[i]); i++) para.push(lines[i]);
    out.push(
      `<p>${para
        .map((t, k) => {
          const hard = k < para.length - 1 && /(\\| {2,})$/.test(t);
          return il(t.replace(/\\$/, '').trim()) + (hard ? '<br>' : k < para.length - 1 ? ' ' : '');
        })
        .join('')}</p>`,
    );
  }
  return out.join('\n');
}
