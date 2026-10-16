// @ts-check
// The phone's bottom navigation as each person arranges it (Настройки → Нижняя панель): «Книга»
// always first, «Ещё» always last, between them up to four sections in the chosen order. A section
// not in the bar is in the "Ещё" sheet — nothing becomes unreachable.

/** @typedef {'search' | 'notes' | 'listen' | 'chat' | 'translate' | 'tasks'} NavId */

/** The sections that can stand in the bar (in the "Ещё" sheet — in this order). */
export const NAV_POOL = /** @type {const} */ ([
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'notes', label: 'Заметки', icon: 'notes' },
  { id: 'listen', label: 'Слушать', icon: 'headphones' },
  { id: 'chat', label: 'Чат', icon: 'discuss' },
  { id: 'translate', label: 'Перевод', icon: 'translate' },
  { id: 'tasks', label: 'Задачи', icon: 'check-square' },
]);

/** Places between «Книга» and «Ещё» (six buttons in all: each stays wide enough for a thumb and its label). */
export const NAV_MAX = 4;
export const NAV_DEFAULT = 'search,notes,listen,chat';

/** The stored setting → the bar's sections (unknown and repeated ids dropped). @param {string} value @returns {NavId[]} */
export function parseNav(value) {
  const ids = /** @type {string[]} */ (NAV_POOL.map((s) => s.id));
  return /** @type {NavId[]} */ ([...new Set(String(value ?? '').split(','))].filter((id) => ids.includes(id)).slice(0, NAV_MAX));
}
