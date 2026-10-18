// @ts-check
// whatsnew.md read: its entries by date ("## 2026-10-18"), the newest first; each point's bold words —
// what the bell shows. Plain (the tests read it).
import { renderMarkdown } from '../../lib/markdown.js';

/** @typedef {{ date: string, html: string, titles: string[] }} Entry */

/** The file cut at its "## 2026-10-18" headings (what stands before the first is the page's own). @param {string} markdown @returns {Entry[]} */
export function parse(markdown) {
  return markdown
    .split(/^## (?=\d{4}-\d{2}-\d{2}\s*$)/m)
    .slice(1)
    .map((part) => {
      const date = part.slice(0, 10);
      const body = part.slice(10).trim();
      const titles = [...body.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1].replace(/[:.]$/, ''));
      return { date, html: renderMarkdown(body), titles };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** "2026-10-18" → "18 октября 2026". @param {string} date */
export const dateText = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
