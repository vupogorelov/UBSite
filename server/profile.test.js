// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createBookVoice } from './bookvoice.js';

test('the display name: set, tidied, cleared back to the login; not the Book\'s', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, username, username_key, created_at) VALUES (1, 'vlad', 'vlad', datetime('now', '-1 day'))");
  const auth = createAuth(db);
  createBookVoice(db, auth, createChat(db, auth)); // the Book exists

  assert.equal(auth.setDisplayName(1, '  Влад   Погорелов '), 'Влад Погорелов');
  assert.equal(auth.userById(1)?.displayName, 'Влад Погорелов');
  assert.equal(auth.setDisplayName(1, '   '), null); // empty — the login is shown
  assert.equal(auth.userById(1)?.displayName, null);
  assert.throws(() => auth.setDisplayName(1, 'x'.repeat(81)), /80/);
  assert.throws(() => auth.setDisplayName(1, 'Книга Урантии'), /Книге/);
  assert.throws(() => auth.setDisplayName(1, 'urantiabook'), /Книге/);
});
