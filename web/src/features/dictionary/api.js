// @ts-check
// The dictionary's exchanges with the server (server/features/dictionary/).
import { request } from '../../lib/api.js';

/** @typedef {'person' | 'being' | 'place' | 'concept' | 'event'} Kind */
/**
 * @typedef {{
 *   id: number, kind: Kind, nameRu: string, nameEn: string, briefRu: string, briefEn: string,
 *   status: 'draft' | 'published', updatedAt: string, paragraphs: number,
 * }} ArticleItem
 */
/**
 * @typedef {ArticleItem & {
 *   bodyRu: string, bodyEn: string,
 *   names: { id: number, ru: string, en: string }[],
 *   places: { ref: string, note: string, ru: string, en: string, paperTitle: string }[],
 *   links: { kind: 'part' | 'belongs' | 'related', id: number, nameRu: string, nameEn: string }[],
 *   occurrences: { paragraphs: number, papers: number, first: string | null, byPaper: { paper: number, titleRu: string, titleEn: string, refs: string[] }[] },
 * }} Article
 */
/** @typedef {{ id: number, kind: Kind, nameRu: string, nameEn: string, briefRu: string, briefEn: string }} Found */
/** @typedef {{ id: number, ru: string, en: string, paragraphs: number }} Candidate */
/** @typedef {{ ref: string, first: boolean, ru: string, en: string }} Hint */

export const dictApi = {
  /** `drafts`: a coordinator's, with the drafts (otherwise the public answer, the same for all). @param {boolean} [drafts] @returns {Promise<ArticleItem[]>} */
  list: (drafts = false) => request('GET', `/api/dict${drafts ? '?drafts=1' : ''}`),
  /** @param {number} id @param {boolean} [drafts] @returns {Promise<Article>} */
  get: (id, drafts = false) => request('GET', `/api/dict/${id}${drafts ? '?drafts=1' : ''}`),
  /** @returns {Promise<Candidate[]>} */
  candidates: () => request('GET', '/api/dict/candidates'),
  /** @param {string} text @param {'ru' | 'en'} lang @returns {Promise<Found | null>} */
  lookup: (text, lang) => request('GET', `/api/dict/lookup?${new URLSearchParams({ text, lang })}`),
  /** @param {number} id @returns {Promise<Hint[]>} */
  hints: (id) => request('GET', `/api/dict/${id}/hints`),
  /** @param {{ nameRu: string, nameEn?: string, kind?: Kind, glossaryIds?: number[] }} b @returns {Promise<{ id: number }>} */
  create: (b) => request('POST', '/api/dict', b),
  /** @param {number} id @param {Partial<Pick<Article, 'kind' | 'nameRu' | 'nameEn' | 'briefRu' | 'briefEn' | 'bodyRu' | 'bodyEn' | 'status'>>} b @returns {Promise<Article>} */
  update: (id, b) => request('PATCH', `/api/dict/${id}`, b),
  /** @param {number} id */
  remove: (id) => request('DELETE', `/api/dict/${id}`),
  /** @param {number} id @param {number[]} glossaryIds @returns {Promise<Article>} */
  setNames: (id, glossaryIds) => request('PUT', `/api/dict/${id}/names`, { glossaryIds }),
  /** @param {number} id @param {{ ref: string, note: string }[]} places @returns {Promise<Article>} */
  setPlaces: (id, places) => request('PUT', `/api/dict/${id}/places`, { places }),
  /** @param {number} id @param {{ id: number, kind: string }[]} links @returns {Promise<Article>} */
  setLinks: (id, links) => request('PUT', `/api/dict/${id}/links`, { links }),
};

/** The kinds, as people name them. @type {[Kind, string, string][]} [kind, one, many] */
export const KINDS = [
  ['person', 'Личность', 'Личности'],
  ['being', 'Существа', 'Существа'],
  ['place', 'Место', 'Места'],
  ['concept', 'Понятие', 'Понятия'],
  ['event', 'Событие', 'События'],
];
/** @param {Kind} kind */
export const kindName = (kind) => KINDS.find(([k]) => k === kind)?.[1] ?? '';
