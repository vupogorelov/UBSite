// @ts-check
// Keeps web/src/app.css free of what never applies (`npm run check`; `--fix` removes it):
// - a selector naming a class used nowhere — not in the interface's code, not in the HTML the server and
//   the shared code make, not in the book's own HTML (its classes listed below);
// - a declaration set again later for the very same selector in the very same context (@media/@supports),
//   the earlier one not !important — it never applies.
// A rule left empty goes, an empty @media too. What is removed changes nothing on screen.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const CSS = join(root, 'web/src/app.css');
/** Classes of the book's own HTML (paragraphs in the database: the Uversa Press markup). */
const BOOK_CLASSES = ['mark', 'jesus', 'leader'];
/** Class-like words of the CSS that are not classes (in urls) or are made up in code (`tr-${kind}`). */
const NOT_CLASSES = ['woff2', 'w3', 'tr-alias'];
const fix = process.argv.includes('--fix');

/** @param {string} dir @param {(f: string) => boolean} test */
function read(dir, test) {
  let out = '';
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out += read(p, test);
    else if (test(f)) out += readFileSync(p, 'utf8') + '\n';
  }
  return out;
}
const code = [
  read(join(root, 'web/src'), (f) => /\.(svelte|js)$/.test(f) && f !== 'app.css'),
  read(join(root, 'server'), (f) => /\.js$/.test(f) && !/\.test\.js$/.test(f)),
  read(join(root, 'shared'), (f) => /\.js$/.test(f) && !/\.test\.js$/.test(f)),
  readFileSync(join(root, 'web/index.html'), 'utf8'),
  readFileSync(join(root, 'web/public/theme.js'), 'utf8'),
  BOOK_CLASSES.join(' '),
].join('\n');

const src = readFileSync(CSS, 'utf8');
const noComments = (/** @type {string} */ s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const used = (/** @type {string} */ c) => NOT_CLASSES.includes(c) || new RegExp(`(^|[^\\w-])${c.replace(/-/g, '\\-')}([^\\w-]|$)`).test(code);
const dead = new Set([...new Set([...noComments(src).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))].filter((c) => !used(c)));

/** @param {string} s */
function splitList(s) {
  /** @type {string[]} */ const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const norm = (/** @type {string} */ s) => noComments(s).replace(/\s+/g, ' ').trim();
const isDead = (/** @type {string} */ sel) => [...noComments(sel).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].some((m) => dead.has(m[1]));

/** A rule's declarations with their spans. @param {string} body @param {number} offset */
function decls(body, offset) {
  /** @type {{ prop: string, important: boolean, start: number, end: number }[]} */
  const out = [];
  let i = 0;
  while (i < body.length) {
    const m = /^(\s+|\/\*[\s\S]*?\*\/)/.exec(body.slice(i));
    if (m) {
      i += m[0].length;
      continue;
    }
    let j = i, depth = 0, quote = '';
    while (j < body.length) {
      const ch = body[j];
      if (quote) quote = ch === quote && body[j - 1] !== '\\' ? '' : quote;
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ';' && depth === 0) break;
      j++;
    }
    const text = body.slice(i, j);
    const colon = text.indexOf(':');
    if (colon > 0) out.push({ prop: text.slice(0, colon).trim().toLowerCase(), important: /!important\s*$/.test(text.trim()), start: offset + i, end: offset + Math.min(j + 1, body.length) });
    i = j + 1;
  }
  return out;
}

/** @type {{ ctx: string, prelude: string, sels: string[], decls: ReturnType<typeof decls>, start: number, open: number, end: number }[]} */
const rules = [];
/** @param {string} text @param {number} offset @param {string} ctx */
function scan(text, offset, ctx) {
  let i = 0;
  while (i < text.length) {
    const m = /^(\s+|\/\*[\s\S]*?\*\/)/.exec(text.slice(i));
    if (m) {
      i += m[0].length;
      continue;
    }
    const open = text.indexOf('{', i), semi = text.indexOf(';', i);
    if (open < 0) break;
    if (semi >= 0 && semi < open) {
      i = semi + 1;
      continue;
    }
    let depth = 1, j = open + 1;
    while (j < text.length && depth) {
      if (text[j] === '/' && text[j + 1] === '*') {
        j = text.indexOf('*/', j) + 2;
        continue;
      }
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const prelude = text.slice(i, open);
    const p = norm(prelude);
    if (p.startsWith('@')) {
      if (/^@(media|supports)/.test(p)) scan(text.slice(open + 1, j - 1), offset + open + 1, `${ctx}|${p}`);
    } else {
      rules.push({ ctx, prelude, sels: splitList(prelude), decls: decls(text.slice(open + 1, j - 1), offset + open + 1), start: offset + i, open: offset + open, end: offset + j });
    }
    i = j;
  }
}
scan(src, 0, '');

// dead selectors
/** @type {{ start: number, end: number, text: string }[]} */
const edits = [];
const report = [];
for (const r of rules) {
  const gone = r.sels.filter(isDead);
  if (!gone.length) continue;
  report.push(`  селектор без употребления: ${gone.map(norm).join(', ')}`);
  const keep = r.sels.filter((s) => !isDead(s));
  edits.push(keep.length ? { start: r.start, end: r.open, text: `${/^\s*/.exec(r.sels[0])?.[0] ?? ''}${keep.map((s) => s.trim()).join(',\n')} ` } : { start: r.start, end: r.end, text: '' });
}
// overridden declarations (in the rules that stay)
/** @type {Map<string, { rule: number, important: boolean }[]>} */
const seen = new Map();
rules.forEach((r, ri) => {
  for (const s of r.sels.filter((x) => !isDead(x)).map(norm)) for (const d of r.decls) {
    const k = `${r.ctx}\n${s}\n${d.prop}`;
    (seen.get(k) ?? seen.set(k, []).get(k))?.push({ rule: ri, important: d.important });
  }
});
rules.forEach((r, ri) => {
  const sels = r.sels.filter((x) => !isDead(x)).map(norm);
  if (!sels.length) return;
  for (const d of r.decls) {
    if (sels.every((s) => (seen.get(`${r.ctx}\n${s}\n${d.prop}`) ?? []).some((x) => x.rule > ri && (x.important || !d.important)))) {
      report.push(`  перекрыто позже: ${sels.join(', ')} { ${d.prop} } (строка ${src.slice(0, d.start).split('\n').length})`);
      edits.push({ start: d.start, end: d.end, text: '' });
    }
  }
});

if (!report.length) {
  console.log('app.css: всё применяется');
  process.exit(0);
}
if (!fix) {
  console.log(`app.css: ${report.length} — не применяется никогда (npm run check:css -- --fix уберёт):\n${report.slice(0, 30).join('\n')}${report.length > 30 ? '\n  …' : ''}`);
  process.exit(1);
}
// fixing: the edits from the end (a declaration inside a removed rule is skipped)
let out = src;
edits.sort((a, b) => b.start - a.start);
let floor = Infinity;
for (const e of edits) {
  if (e.end > floor) continue;
  let { start: a, end: b } = e;
  if (!e.text) {
    const ls = out.lastIndexOf('\n', a - 1) + 1;
    if (/^\s*$/.test(out.slice(ls, a))) a = ls;
    const le = out.indexOf('\n', b);
    if (le >= 0 && /^[ \t]*$/.test(out.slice(b, le))) b = le + 1;
  }
  out = out.slice(0, a) + e.text + out.slice(b);
  floor = a;
}
for (let pass = 0; pass < 3; pass++) {
  const before = out;
  out = out.replace(/(^|\n)[ \t]*[^{}@\n;][^{};]*\{\s*\}[ \t]*(?=\n|$)/g, '$1').replace(/(^|\n)[ \t]*@(media|supports)[^{]*\{\s*\}[ \t]*(?=\n|$)/g, '$1');
  if (out === before) break;
}
writeFileSync(CSS, out.replace(/\n{3,}/g, '\n\n'));
console.log(`app.css: убрано ${report.length}`);
