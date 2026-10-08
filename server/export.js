// @ts-check
// Export of the new edition: the book text with the approved variants in place, as Markdown,
// and the list of changes as CSV.
import { HttpError } from './http.js';

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/**
 * @typedef {{ text: string, italic: boolean, kind: 'same' | 'del' | 'ins', change?: Change }} Run
 * @typedef {{ id: number, ref: string, start: number, end: number, original: string, text: string,
 *   author: string, decidedAt: string, votes: { for: number, against: number, abstain: number } }} Change
 * @typedef {{ ref: string, sectionNum: number, ru: Run[], en: Run[] }} Para
 * @typedef {{ id: number, titleRu: string, titleEn: string, partId: number, partRu: string, partEn: string,
 *   sections: Map<number, { ru: string | null, en: string | null }>, paragraphs: Para[] }} Paper
 * @typedef {{ scope: string, lang: 'ru' | 'ruen', changes: boolean }} Options
 */

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
const decode = (/** @type {string} */ s) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m,
  );

/**
 * Splits a paragraph's HTML (text, entities, <i>) into runs, replacing the fragments of the
 * changes: the original wording becomes "del" runs followed by one "ins" run.
 * Offsets of the changes are in the plain text (the HTML's textContent).
 * @param {string} html @param {Change[]} changes non-overlapping
 * @returns {Run[]}
 */
export function editionRuns(html, changes) {
  const list = [...changes].sort((a, b) => a.start - b.start);
  /** @type {Run[]} */
  const runs = [];
  let italic = false;
  let pos = 0;
  let ci = 0;
  /** @type {Change | null} */
  let open = null;
  const push = (/** @type {string} */ ch) => {
    const kind = open ? 'del' : 'same';
    const last = runs.at(-1);
    if (last && last.kind === kind && last.italic === italic && last.change === (open ?? undefined)) last.text += ch;
    else runs.push({ text: ch, italic, kind, ...(open ? { change: open } : {}) });
  };
  const close = () => {
    const c = /** @type {Change} */ (open);
    runs.push({ text: c.text, italic: false, kind: 'ins', change: c });
    open = null;
    ci++;
  };
  let i = 0;
  while (i < html.length) {
    if (!open && ci < list.length && pos === list[ci].start) open = list[ci];
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      const tag = html.slice(i, end + 1);
      if (tag === '<i>') italic = true;
      else if (tag === '</i>') italic = false;
      i = end + 1;
      continue;
    }
    let len = 1;
    if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      if (semi > i && semi - i <= 8) len = semi - i + 1;
    }
    push(decode(html.slice(i, i + len)));
    i += len;
    pos++;
    if (open && pos === /** @type {Change} */ (open).end) close();
  }
  if (open) close();
  return runs;
}

/**
 * @param {DatabaseSync} db
 * @param {ReturnType<typeof import('./translation.js').createTranslation>} tr
 */
export function createExport(db, tr) {
  const q = {
    papers: db.prepare(`
      SELECT p.id, p.title_ru AS titleRu, p.title_en AS titleEn, p.part_id AS partId, pt.title_ru AS partRu, pt.title_en AS partEn
      FROM papers p JOIN parts pt ON pt.id = p.part_id ORDER BY p.id`),
    sections: db.prepare('SELECT num, title_ru AS ru, title_en AS en FROM sections WHERE paper_id = ? ORDER BY num'),
    paragraphs: db.prepare('SELECT ref, section_num AS sectionNum, html_ru AS ru, html_en AS en FROM paragraphs WHERE paper_id = ? ORDER BY seq'),
    approved: db.prepare(`
      SELECT p.id, p.ref, p.start_pos AS start, p.end_pos AS "end", p.original, v.text, p.version,
             coalesce(u.display_name, u.username) AS author, coalesce(p.decided_at, p.updated_at) AS decidedAt
      FROM proposals p JOIN proposal_versions v ON v.proposal_id = p.id AND v.version = p.version
      JOIN users u ON u.id = p.author_id
      JOIN paragraphs pa ON pa.ref = p.ref
      WHERE p.status = 'approved' AND pa.paper_id = ?`),
  };

  /** @param {string} scope "all" | "part:N" | "paper:N" */
  function papersIn(scope) {
    const [kind, num] = scope.split(':');
    const n = Number(num);
    const all = /** @type {any[]} */ (q.papers.all());
    const list = kind === 'all' ? all : kind === 'part' ? all.filter((p) => p.partId === n) : kind === 'paper' ? all.filter((p) => p.id === n) : null;
    if (!list || !list.length) throw new HttpError(400, 'Неизвестный объём экспорта');
    return list;
  }

  /** @param {string} scope @returns {{ papers: Paper[], changes: Change[] }} */
  function load(scope) {
    /** @type {Change[]} */
    const changes = [];
    const papers = papersIn(scope).map((p) => {
      const byRef = Map.groupBy(
        /** @type {any[]} */ (q.approved.all(p.id)).map((c) => {
          const t = tr.tally(c.id, c.version);
          return /** @type {Change} */ ({ ...c, votes: { for: t.for, against: t.against, abstain: t.abstain } });
        }),
        (c) => c.ref,
      );
      const paragraphs = /** @type {any[]} */ (q.paragraphs.all(p.id)).map((r) => {
        const own = byRef.get(r.ref) ?? [];
        changes.push(...own.sort((a, b) => a.start - b.start));
        return { ref: r.ref, sectionNum: r.sectionNum, ru: editionRuns(r.ru, own), en: editionRuns(r.en, []) };
      });
      const sections = new Map(/** @type {any[]} */ (q.sections.all(p.id)).map((s) => [s.num, { ru: s.ru, en: s.en }]));
      return { ...p, sections, paragraphs };
    });
    return { papers, changes };
  }

  const paperTitle = (/** @type {Paper} */ p) => (p.id === 0 ? p.titleRu || 'Предисловие' : `Текст ${p.id}. ${p.titleRu}`);
  const sectionTitle = (/** @type {Paper} */ p, /** @type {number} */ num) => {
    const s = p.sections.get(num);
    if (!num || !s?.ru) return null;
    return `${p.id === 0 ? ROMAN[num] ?? num : num}. ${s.ru}`;
  };
  const date = () => new Date().toISOString().slice(0, 10);
  const scopeLabel = (/** @type {Paper[]} */ papers, /** @type {string} */ scope) =>
    scope === 'all' ? 'вся книга' : scope.startsWith('part:') ? `часть ${ROMAN[papers[0].partId] ?? papers[0].partId}` : paperTitle(papers[0]);
  const fileBase = (/** @type {string} */ scope) => `ub-novaya-redakciya-${scope === 'all' ? 'kniga' : scope.replace(':', '-')}-${date()}`;
  const changeLine = (/** @type {Change} */ c) =>
    `${c.ref} — «${c.original}» → «${c.text}» (${c.author}, ${c.decidedAt.slice(0, 10)}; ${c.votes.for} за, ${c.votes.against} против)`;

  /** @param {Options} o */
  function markdown(o) {
    const { papers, changes } = load(o.scope);
    // Italic runs as *…*, with the spaces kept outside the asterisks; adjacent italic runs merge.
    const md = (/** @type {Run[]} */ runs) =>
      runs
        .filter((r) => r.kind !== 'del')
        .map((r) => (r.italic && r.text.trim() ? r.text.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1*$2*$3') : r.text))
        .join('')
        .replace(/\*\*/g, '');
    const out = [`# Книга Урантии — новая редакция`, '', `Объём: ${scopeLabel(papers, o.scope)} · сформировано ${date()} · принятых изменений: ${changes.length}`, ''];
    let part = -1;
    for (const p of papers) {
      if (p.partId !== part) {
        part = p.partId;
        out.push(`## Часть ${ROMAN[part] ?? part}. ${p.partRu}`, '');
      }
      out.push(`### ${paperTitle(p)}`, '');
      if (o.lang === 'ruen') out.push(`*${p.titleEn}*`, '');
      let section = -1;
      for (const para of p.paragraphs) {
        if (para.sectionNum !== section) {
          section = para.sectionNum;
          const t = sectionTitle(p, section);
          if (t) out.push(`#### ${t}`, '');
        }
        out.push(`**${para.ref}** ${md(para.ru)}`, '');
        if (o.lang === 'ruen') out.push(`> ${md(para.en)}`, '');
      }
    }
    if (o.changes && changes.length) {
      out.push('---', '', '## Список изменений', '');
      for (const c of changes) out.push(`- ${changeLine(c)}`);
      out.push('');
    }
    return { name: `${fileBase(o.scope)}.md`, body: out.join('\n') };
  }

  /** The list of changes as CSV for Excel (UTF-8 with BOM, ";" separated). @param {Options} o */
  function csv(o) {
    const { changes } = load(o.scope);
    const cell = (/** @type {string | number} */ v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ['Абзац', 'Было', 'Стало', 'Автор', 'Принято', 'За', 'Против', 'Воздержались'],
      ...changes.map((c) => [c.ref, c.original, c.text, c.author, c.decidedAt, c.votes.for, c.votes.against, c.votes.abstain]),
    ];
    return { name: `ub-izmeneniya-${o.scope === 'all' ? 'kniga' : o.scope.replace(':', '-')}-${date()}.csv`, body: '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n' };
  }

  return { load, markdown, csv };
}
