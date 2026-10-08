// @ts-check
// Daily consistent copy of the database (VACUUM INTO) next to it in backups/; the newest N are kept.
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_DB_PATH } from './db.js';

const KEEP = Number(process.env.UB_BACKUPS_KEEP ?? 14);

/** @param {import('node:sqlite').DatabaseSync} db */
export function backupNow(db) {
  const dir = join(dirname(DEFAULT_DB_PATH), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ub-${new Date().toISOString().slice(0, 10)}.db`);
  if (existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter((f) => /^ub-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) rmSync(join(dir, f));
  return file;
}

/** Checks every few hours and makes at most one copy per day. @param {import('node:sqlite').DatabaseSync} db */
export function startBackups(db) {
  if (process.env.UB_BACKUPS === '0') return;
  const run = () => {
    try {
      const file = backupNow(db);
      if (file) console.log(`Backup: ${file}`);
    } catch (err) {
      console.error('Backup failed:', err);
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 3_600_000).unref();
}
