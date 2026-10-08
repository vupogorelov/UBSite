// @ts-check
// Account administration from the console (works with the server running or stopped).
//   npm run admin -- init <username>     first administrator; takes over existing notes; prints a link to set the password
//   npm run admin -- reset <username>    prints a link to set a new password
//   npm run admin -- invite [--admin]    prints a link that creates a new account
// Links use UB_PUBLIC_URL (e.g. https://example.org) or http://127.0.0.1:<UB_PORT>.
import { openDb, transaction } from '../server/db.js';
import { createAuth, checkUsername } from '../server/auth.js';
import { sanitizeSettings } from '../shared/settings.js';

const base = (process.env.UB_PUBLIC_URL ?? `http://127.0.0.1:${process.env.UB_PORT ?? 4300}`).replace(/\/$/, '');
const [command, arg] = process.argv.slice(2);
const db = openDb();
const auth = createAuth(db);

/** @param {string} msg */
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** @param {string} username */
function userId(username) {
  const row = /** @type {{ id: number } | undefined} */ (db.prepare('SELECT id FROM users WHERE username_key = ?').get(username.toLowerCase()));
  if (!row) fail(`Пользователь «${username}» не найден`);
  return /** @type {{ id: number }} */ (row).id;
}

if (command === 'init') {
  if (!arg) fail('Укажите имя: npm run admin -- init <имя>');
  if (/** @type {{ n: number }} */ (db.prepare('SELECT count(*) AS n FROM users').get()).n > 0) {
    fail('Пользователи уже есть. Для нового пароля: npm run admin -- reset <имя>');
  }
  const username = checkUsername(arg);
  const id = transaction(db, () => {
    const legacy = /** @type {{ id: number, settings: string } | undefined} */ (
      db.prepare("SELECT id, settings FROM workspaces WHERE id = 1 AND owner_id IS NULL AND kind = 'personal'").get()
    );
    if (!legacy) return auth.createUser(username, null, null, true);

    // Existing single-user data: workspace 1 becomes the admin's personal workspace.
    const { id } = /** @type {{ id: number }} */ (
      db.prepare('INSERT INTO users (username, username_key, is_admin) VALUES (?, ?, 1) RETURNING id').get(username, username.toLowerCase())
    );
    db.prepare('UPDATE workspaces SET owner_id = ? WHERE id = 1').run(id);
    auth.addMember(1, id, 'owner');
    db.prepare('UPDATE annotations SET author_id = ? WHERE author_id IS NULL').run(id);
    db.prepare('UPDATE comments SET author_id = ? WHERE author_id IS NULL').run(id);
    db.prepare('UPDATE search_history SET user_id = ? WHERE user_id IS NULL').run(id);
    // Appearance settings become personal; color names stay shared.
    const old = JSON.parse(legacy.settings);
    db.prepare('INSERT INTO user_settings (user_id, workspace_id, settings) VALUES (?, 1, ?)').run(id, JSON.stringify(sanitizeSettings(old, 'user')));
    db.prepare('UPDATE workspaces SET settings = ? WHERE id = 1').run(JSON.stringify(sanitizeSettings(old, 'workspace')));
    return id;
  });
  const token = auth.createInvite({ kind: 'reset', userId: id });
  console.log(`Администратор «${username}» создан. Задайте пароль по ссылке (действует 7 дней):\n${base}/invite/${token}`);
} else if (command === 'reset') {
  if (!arg) fail('Укажите имя: npm run admin -- reset <имя>');
  const token = auth.createInvite({ kind: 'reset', userId: userId(arg) });
  console.log(`Ссылка для нового пароля «${arg}» (7 дней):\n${base}/invite/${token}`);
} else if (command === 'invite') {
  const token = auth.createInvite({ kind: 'account', isAdmin: arg === '--admin' });
  console.log(`Приглашение для новой учётной записи${arg === '--admin' ? ' администратора' : ''} (7 дней):\n${base}/invite/${token}`);
} else {
  console.log('Команды: init <имя> | reset <имя> | invite [--admin]');
}
