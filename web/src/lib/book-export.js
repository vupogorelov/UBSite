// @ts-check

/**
 * @typedef {{
 *   paper: import('./api.js').PaperData['paper'],
 *   sections: import('./api.js').PaperData['sections'],
 *   paragraphs: (import('./api.js').Paragraph & { cleanRu: string })[]
 * }} ExportPaper
 */

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** @param {string} text */
function codeBlock(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** @param {string} text */
function blockquote(text) {
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/**
 * @param {{
 *   toc: import('./api.js').Toc,
 *   papers: ExportPaper[],
 *   notes?: import('./api.js').Note[],
 *   comments?: { ref: string, authorName: string | null, body: string }[],
 *   includeNotes?: boolean,
 *   russianOnly?: boolean
 * }} data
 */
export function formatBookExport({ toc, papers, notes = [], comments = [], includeNotes = false, russianOnly = false }) {
  if (russianOnly) {
    const text = [];
    for (const data of papers) {
      const { paper, sections, paragraphs } = data;
      if (paper.partStart) {
        text.push(paper.partTitleRu, paper.partIntroRu ?? '');
      }
      text.push(paper.titleRu);
      let currentSection = -1;
      for (const paragraph of paragraphs) {
        if (paragraph.sectionNum !== currentSection) {
          currentSection = paragraph.sectionNum;
          const section = sections.find((s) => s.num === currentSection);
          if (section && currentSection > 0) text.push(section.titleRu ?? '');
        }
        text.push(paragraph.cleanRu.trim());
      }
    }
    return `${text.filter(Boolean).join('\n\n')}\n`;
  }

  const notesByRef = new Map();
  for (const note of notes) {
    const entries = notesByRef.get(note.ref) ?? [];
    entries.push(note);
    notesByRef.set(note.ref, entries);
  }
  const commentsByRef = new Map();
  for (const comment of comments) {
    const entries = commentsByRef.get(comment.ref) ?? [];
    entries.push(comment);
    commentsByRef.set(comment.ref, entries);
  }
  const lines = ['# Книга Урантии'];
  let currentPart = null;

  for (const data of papers) {
    const { paper, sections, paragraphs } = data;
    const part = toc.parts.find((p) => p.id === paper.partId);
    if (part && part.id !== currentPart) {
      lines.push('', `## Часть ${ROMAN[part.id] ?? part.id}. ${part.titleRu}`);
      if (part.titleEn) lines.push(blockquote(part.titleEn));
      currentPart = part.id;
    }
    if (paper.partStart && (paper.partIntroRu || paper.partIntroEn)) {
      const intro = [];
      if (paper.partIntroRu) intro.push(paper.partIntroRu);
      if (paper.partIntroEn) intro.push(blockquote(paper.partIntroEn));
      lines.push('', intro.join('\n\n'));
    }

    const title = paper.id === 0 ? 'Предисловие' : `${paper.id}. ${paper.titleRu}`;
    lines.push('', `### ${title}`);
    if (paper.titleEn) lines.push(blockquote(paper.titleEn));
    let currentSection = -1;

    for (const paragraph of paragraphs) {
      if (paragraph.sectionNum !== currentSection) {
        currentSection = paragraph.sectionNum;
        const section = sections.find((s) => s.num === currentSection);
        if (section && currentSection > 0) {
          lines.push('', `#### ${section.num}. ${section.titleRu ?? ''}`);
          if (section.titleEn) lines.push(blockquote(section.titleEn));
        }
      }

      lines.push('', `**${paragraph.ref}** ${paragraph.ru}`, blockquote(paragraph.en));

      if (!includeNotes) continue;
      const entries = [];
      for (const note of notesByRef.get(paragraph.ref) ?? []) {
        const details = [];
        if (note.bookmark) details.push('Закладка');
        if (note.title) details.push(note.title);
        if (note.quote && note.quote !== note.title) details.push(`Цитата: ${note.quote}`);
        if (note.tags.length) details.push(`Метки: ${note.tags.map((/** @type {string} */ tag) => `#${tag}`).join(' ')}`);
        if (details.length) entries.push(codeBlock(`Заметка${note.authorName ? ` · ${note.authorName}` : ''}\n${details.join('\n')}`));
        for (const comment of note.comments) {
          if (comment.kind === 'event' || comment.hiddenAt || !comment.body.trim()) continue;
          entries.push(codeBlock(`Комментарий${comment.authorName ? ` · ${comment.authorName}` : ''}\n${comment.body}`));
        }
      }
      for (const comment of commentsByRef.get(paragraph.ref) ?? []) {
        if (!comment.body.trim()) continue;
        entries.push(codeBlock(`Обсуждение абзаца${comment.authorName ? ` · ${comment.authorName}` : ''}\n${comment.body}`));
      }
      if (entries.length) lines.push('', '**Заметки и комментарии**', '', ...entries);
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
