// @ts-check
// Who can read a chat — shown on its avatar (a small badge) and under its title.
import { plural } from './format.js';

/**
 * para (a paragraph's thread) and chan (a channel): every user of the platform;
 * ws (a group workspace's chat): the workspace's members; private (one-to-one, saved messages —
 * not yet in the app): only you / you and the other person.
 * @param {{ kind: string, title: string, members?: number }} c
 * @returns {{ icon: 'globe' | 'users' | 'lock', short: string, full: string }}
 */
export function visibility(c) {
  if (c.kind === 'ws') {
    const n = c.members ?? 0;
    return {
      icon: 'users',
      short: n ? `Видят ${n} ${plural(n, 'участник', 'участника', 'участников')}` : 'Видят участники пространства',
      full: `Видят только участники пространства «${c.title}»${n ? ` (${n})` : ''}`,
    };
  }
  if (c.kind === 'dm') return { icon: 'lock', short: 'Видите только вы', full: 'Ваш разговор с Книгой — его видите только вы' };
  if (c.kind === 'private') return { icon: 'lock', short: 'Видите только вы', full: 'Видите только вы' };
  return { icon: 'globe', short: 'Видят все', full: 'Видят все пользователи платформы' };
}
