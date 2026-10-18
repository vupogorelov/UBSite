// @ts-check
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from './migrations.js';
import { keepNumbers } from '../shared/typography.js';

export const DEFAULT_DB_PATH =
  process.env.UB_DB ?? fileURLToPath(new URL('../data/ub.db', import.meta.url));

/**
 * @param {string} [file]
 * @returns {DatabaseSync}
 */
export function openDb(file = DEFAULT_DB_PATH) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL; `synchronous` stays FULL (SQLite's default): a commit survives a power cut — the writes are
  // small, durability comes first. The log file is cut back to 32 MB after a checkpoint (without the
  // limit it keeps its largest size for good).
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 33554432;');
  // (for the migrations: a number's groups of digits kept together in the shown text — shared/typography.js)
  db.function('keep_numbers', { deterministic: true }, (html) => keepNumbers(String(html)));
  migrate(db);
  return db;
}

/** @param {DatabaseSync} db */
function migrate(db) {
  const row = /** @type {{ user_version: number }} */ (db.prepare('PRAGMA user_version').get());
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/**
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
