// @ts-check
// Daily consistent copy of the database (VACUUM INTO) in backups/ next to it (or UB_BACKUP_DIR); the
// newest N are kept. A copy is written under a temporary name, checked (integrity_check) and only then
// renamed: a copy cut short (the process stopped, the disk full) or damaged never takes a day's name.
import { mkdirSync, readdirSync, rmSync, existsSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_DB_PATH } from './db.js';

const KEEP = Number(process.env.UB_BACKUPS_KEEP ?? 14);
/** Where the copies go: by default next to the database; another disk when given. */
export const BACKUP_DIR = process.env.UB_BACKUP_DIR ?? join(dirname(DEFAULT_DB_PATH), 'backups');
const DAILY = /^ub-\d{4}-\d{2}-\d{2}\.db$/;

/** "ok", or what SQLite found wrong in the file. @param {string} file */
export function checkFile(file) {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = /** @type {{ integrity_check: string }[]} */ (copy.prepare('PRAGMA integrity_check').all());
    return rows.map((r) => r.integrity_check).join('; ');
  } finally {
    copy.close();
  }
}

/** @param {import('node:sqlite').DatabaseSync} db @param {string} [dir] @returns {string | null} the new copy (null: today's is there) */
export function backupNow(db, dir = BACKUP_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ub-${new Date().toISOString().slice(0, 10)}.db`);
  if (existsSync(file)) return null;
  const tmp = `${file}.partial`;
  rmSync(tmp, { force: true }); // (a copy cut short before)
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const verdict = checkFile(tmp);
  if (verdict !== 'ok') {
    rmSync(tmp, { force: true });
    throw new Error(`the copy did not pass the check: ${verdict.slice(0, 300)}`);
  }
  renameSync(tmp, file);
  const old = readdirSync(dir).filter((f) => DAILY.test(f)).sort().slice(0, -KEEP);
  for (const f of old) rmSync(join(dir, f));
  return file;
}

/** The newest daily copy and its age in hours (null — none yet). @param {string} [dir] */
export function lastBackup(dir = BACKUP_DIR) {
  try {
    const name = readdirSync(dir).filter((f) => DAILY.test(f)).sort().at(-1);
    if (!name) return null;
    return { name, hours: Math.round((Date.now() - statSync(join(dir, name)).mtimeMs) / 3_600_000) };
  } catch {
    return null;
  }
}

/** Checks every few hours and makes at most one copy per day. @param {import('node:sqlite').DatabaseSync} db */
export function startBackups(db) {
  if (process.env.UB_BACKUPS === '0') return;
  const run = () => {
    try {
      const file = backupNow(db);
      if (file) console.log(`${new Date().toISOString()} Backup: ${file}`);
    } catch (err) {
      console.error(`${new Date().toISOString()} Backup failed:`, err);
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 3_600_000).unref();
}
