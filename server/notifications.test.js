// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createTranslation } from './translation.js';
import { createNotifications } from './notifications.js';

test('notifications: following by taking part, read on opening, mute and the vote queue', () => {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO users (id, username, username_key, is_translator) VALUES
    (1, 'author', 'author', 1), (2, 'a', 'a', 1), (3, 'reader', 'reader', 0)`);
  const tr = createTranslation(db);
  const n = createNotifications(db, tr);
  const user = (/** @type {number} */ id, translator = true) =>
    ({ id, username: 'u', displayName: null, email: null, emailVerified: false, isAdmin: false, isTranslator: translator, isCoordinator: false });
  const say = (/** @type {number} */ author, /** @type {string} */ body, ago = 0) =>
    db.prepare(`INSERT INTO public_messages (ref, author_id, body, created_at) VALUES ('5:1.1', ?, ?, datetime('now', ?))`)
      .run(author, body, `-${ago} minutes`);

  say(2, 'before the author took part', 60);
  assert.equal(n.counts(user(1)).unread, 0); // not following yet
  const { id } = /** @type {{ id: number }} */ (
    db.prepare("INSERT INTO proposals (ref, start_pos, end_pos, original, author_id, created_at) VALUES ('5:1.1', 0, 3, 'abc', 1, datetime('now', '-30 minutes')) RETURNING id").get()
  );
  db.prepare("INSERT INTO proposal_versions (proposal_id, version, text) VALUES (?, 1, 'x')").run(id);
  tr.publish(id, user(1)); // its own event is not news for the author
  assert.equal(n.counts(user(1)).unread, 0);
  assert.equal(n.following(1, '5:1.1'), true);

  say(2, 'a reply');
  assert.equal(n.counts(user(1)).unread, 1);
  assert.equal(n.list(user(1))[0].body, 'a reply');
  assert.equal(n.list(user(1))[0].unread, true);
  n.markSeen(user(1));
  assert.equal(n.counts(user(1)).unread, 0);
  assert.equal(n.list(user(1))[0].unread, false);

  // The queue: a translator who has not voted yet; the author does not vote.
  assert.deepEqual(n.queue(user(2)), [id]);
  assert.deepEqual(n.queue(user(1)), []);
  assert.deepEqual(n.queue(user(3, false)), []);
  db.prepare('INSERT INTO votes (proposal_id, version, user_id, value) VALUES (?, 1, 2, 1)').run(id);
  assert.deepEqual(n.queue(user(2)), []);

  // Mute, then writing in the thread follows it again; a reader may follow without taking part.
  n.setFollow(1, '5:1.1', false);
  say(2, 'while muted');
  assert.equal(n.counts(user(1)).unread, 0);
  n.unmute(1, '5:1.1');
  assert.equal(n.following(1, '5:1.1'), true);
  assert.equal(n.following(3, '5:1.1'), false);
  db.exec("UPDATE public_messages SET created_at = datetime('now', '-5 minutes')"); // all of it came before the reader
  n.setFollow(3, '5:1.1', true);
  say(2, 'for the reader');
  assert.equal(n.counts(user(3, false)).unread, 1);
});
