// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBookExport } from './book-export.js';

const toc = {
  parts: [{ id: 1, titleRu: 'Часть первая', titleEn: 'The First Part', subtitleRu: null }],
  papers: [{ id: 5, partId: 1, titleRu: 'Небесный Отец', titleEn: 'The Heavenly Father' }],
  sections: [],
};
const paper = {
  paper: {
    id: 5, partId: 1, titleRu: 'Небесный Отец', titleEn: 'The Heavenly Father',
    partTitleRu: 'Тема части', partTitleEn: 'Part theme',
    partIntroRu: 'Вступление части', partIntroEn: 'Part introduction', partStart: 1,
  },
  sections: [],
  paragraphs: [
    { ref: '5:1.1', sectionNum: 0, pageRef: '', ru: 'Русский абзац', en: 'English paragraph', cleanRu: 'Русский абзац' },
    { ref: '5:1.2', sectionNum: 0, pageRef: '', ru: 'Следующий абзац', en: 'Next paragraph', cleanRu: 'Следующий абзац' },
  ],
};

test('Markdown alternates Russian and English for each numbered paragraph', () => {
  const result = formatBookExport({ toc, papers: [paper] });
  assert.ok(result.indexOf('Вступление части') < result.indexOf('Небесный Отец'));
  assert.ok(result.indexOf('Part introduction') < result.indexOf('The Heavenly Father'));
  assert.ok(result.indexOf('Русский абзац') < result.indexOf('English paragraph'));
  assert.ok(result.indexOf('English paragraph') < result.indexOf('Следующий абзац'));
  assert.match(result, /\*\*5:1\.1\*\*/);
  assert.match(result, /## Часть I\. Часть первая — The First Part/);
});

test('notes and paragraph comments follow the translations in code blocks', () => {
  const notes = [{
    id: 1, ref: '5:1.1', lang: null, start: null, end: null, quote: 'Цитата', color: null, bookmark: false,
    title: 'Моя мысль', resolved: false, createdAt: '', updatedAt: '', paperId: 5, sectionNum: 0, paperTitle: '',
    authorId: 1, authorName: 'Анна', comments: [{
      id: 2, body: 'Комментарий к заметке', createdAt: '', updatedAt: '', authorId: 1, authorName: 'Анна',
    }], tags: ['важно'],
  }];
  const comments = [{ ref: '5:1.1', authorName: 'Борис', body: 'Обсуждение абзаца' }];
  const result = formatBookExport({ toc, papers: [paper], notes, comments, includeNotes: true });
  const english = result.indexOf('English paragraph');
  const firstCodeBlock = result.indexOf('```');
  assert.ok(english < firstCodeBlock);
  assert.match(result, /Заметка · Анна/);
  assert.match(result, /Комментарий · Анна/);
  assert.match(result, /Обсуждение абзаца · Борис/);
  assert.match(result, /Метки: #важно/);
});

test('a code fence grows to protect embedded backticks in a comment', () => {
  const notes = [{
    id: 1, ref: '5:1.1', lang: null, start: null, end: null, quote: null, color: null, bookmark: false,
    title: null, resolved: false, createdAt: '', updatedAt: '', paperId: 5, sectionNum: 0, paperTitle: '',
    authorId: 1, authorName: null, comments: [{
      id: 2, body: 'Use ``` here', createdAt: '', updatedAt: '', authorId: 1, authorName: null,
    }], tags: [],
  }];
  const result = formatBookExport({ toc, papers: [paper], notes, includeNotes: true });
  assert.match(result, /````\nКомментарий\nUse ``` here\n````/);
});

test('Russian narration export contains only unnumbered Russian paragraphs', () => {
  const result = formatBookExport({ toc, papers: [paper], includeNotes: true, russianOnly: true });
  assert.equal(result, 'Тема части\n\nВступление части\n\nНебесный Отец\n\nРусский абзац\n\nСледующий абзац\n');
  assert.doesNotMatch(result, /5:1|\b5\b|English|Part theme|Part introduction|Моя мысль|```/);
});
