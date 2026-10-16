// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.js';
import { backupNow, lastBackup, checkFile } from './backup.js';

test('the daily copy: checked before it takes the day\'s name, once a day, the oldest go; a cut-short copy is replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-backup-'));
  try {
    const db = openDb(':memory:');
    db.exec("INSERT INTO users (id, username, username_key) VALUES (1, 'anna', 'anna')");
    const today = `ub-${new Date().toISOString().slice(0, 10)}.db`;
    // a copy cut short before (the process stopped mid-way): left under its temporary name
    writeFileSync(join(dir, `${today}.partial`), 'not a database');
    // copies of earlier days, more than are kept
    for (let d = 1; d <= 15; d++) writeFileSync(join(dir, `ub-2020-01-${String(d).padStart(2, '0')}.db`), '');

    const file = backupNow(db, dir);
    assert.equal(file, join(dir, today));
    assert.equal(checkFile(join(dir, today)), 'ok');
    assert.equal(backupNow(db, dir), null, 'one copy a day');
    const names = readdirSync(dir);
    assert.ok(!names.some((n) => n.endsWith('.partial')), 'the cut-short copy is gone');
    assert.equal(names.filter((n) => /^ub-\d{4}-\d{2}-\d{2}\.db$/.test(n)).length, 14, 'the newest 14 are kept');
    assert.equal(lastBackup(dir)?.name, today);
    assert.equal(lastBackup(join(dir, 'none')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
