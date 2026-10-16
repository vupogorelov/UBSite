// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createTranslation, outcome, sanitizeVoting, DEFAULT_VOTING } from './translation.js';

test('voting rule: share of decisive votes plus quorum', () => {
  const cfg = DEFAULT_VOTING; // 80%, quorum 3
  assert.equal(outcome({ for: 1, against: 0, abstain: 5 }, cfg).passes, false); // no quorum: abstentions do not count
  assert.equal(outcome({ for: 3, against: 0, abstain: 0 }, cfg).passes, true);
  assert.equal(outcome({ for: 4, against: 1, abstain: 0 }, cfg).passes, true); // exactly 80%
  assert.equal(outcome({ for: 3, against: 1, abstain: 0 }, cfg).passes, false); // 75%
  assert.deepEqual(sanitizeVoting({ threshold: 2, quorum: 0, durationDays: 7, authorCanVote: 'yes' }), {
    ...DEFAULT_VOTING,
    durationDays: 7,
  });
});

/** In-memory DB with users and helpers to create proposals. */
function setup() {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO users (id, username, username_key, is_translator) VALUES
    (1, 'author', 'author', 1), (2, 'a', 'a', 1), (3, 'b', 'b', 1), (4, 'c', 'c', 1), (5, 'reader', 'reader', 0)`);
  const tr = createTranslation(db);
  const add = (/** @type {number} */ start, /** @type {number} */ end, /** @type {number} */ author = 1) => {
    const { id } = /** @type {{ id: number }} */ (
      db.prepare("INSERT INTO proposals (ref, start_pos, end_pos, original, author_id) VALUES ('5:1.1', ?, ?, 'x', ?) RETURNING id").get(start, end, author)
    );
    db.prepare("INSERT INTO proposal_versions (proposal_id, version, text) VALUES (?, 1, 'y')").run(id);
    return id;
  };
  const vote = (/** @type {number} */ id, /** @type {number} */ user, /** @type {number} */ value) => {
    db.prepare('INSERT INTO votes (proposal_id, version, user_id, value) VALUES (?, 1, ?, ?)').run(id, user, value);
    return tr.evaluate(id);
  };
  const user = (/** @type {number} */ id, translator = true) =>
    ({ id, username: 'u', displayName: null, email: null, emailVerified: false, isAdmin: false, isTranslator: translator, isCoordinator: false });
  const status = (/** @type {number} */ id) => tr.get(id).status;
  return { db, tr, add, vote, user, status };
}

test('publishing, early approval and replacement of covered fragments', () => {
  const { tr, add, vote, user, status } = setup();
  const first = add(10, 20);
  assert.throws(() => tr.publish(first, user(5, false)), /автор/i); // not the author
  assert.throws(() => tr.publish(first, user(1, false)), /переводчики/); // author but not a translator
  assert.equal(tr.publish(first, user(1)), 'voting');
  assert.equal(vote(first, 2, 1), 'voting');
  assert.equal(vote(first, 3, 1), 'voting');
  assert.equal(vote(first, 4, 1), 'approved'); // 3 of 3, quorum reached

  const partial = add(15, 30);
  assert.throws(() => tr.publish(partial, user(1)), /накрывало его целиком/);
  const covering = add(5, 30);
  tr.publish(covering, user(1));
  vote(covering, 2, 1);
  vote(covering, 3, 1);
  vote(covering, 4, 1);
  assert.equal(status(covering), 'approved');
  assert.equal(status(first), 'superseded');
});

test('approval returns proposals under vote that touch the new fragment only partly', () => {
  const { tr, add, vote, user, status } = setup();
  const winner = add(10, 20);
  const partly = add(15, 30, 2); // overlaps the winner without covering it
  const covering = add(5, 25, 3); // covers the winner entirely
  const apart = add(40, 50, 4);
  for (const [id, author] of [[winner, 1], [partly, 2], [covering, 3], [apart, 4]]) tr.publish(id, user(author));
  vote(winner, 2, 1);
  vote(winner, 3, 1);
  vote(winner, 4, 1);
  assert.equal(status(winner), 'approved');
  assert.equal(status(partly), 'draft');
  assert.match(tr.get(partly).decision_note, /накрывала|накрывало его целиком/);
  assert.equal(status(covering), 'voting'); // may still replace the winner
  assert.equal(status(apart), 'voting');
  assert.throws(() => tr.publish(partly, user(2)), /накрывало его целиком/); // must be widened first
});

test('end of the voting period: rejected with quorum, back to draft without it', () => {
  const { db, tr, add, vote, user, status } = setup();
  const disputed = add(0, 5);
  const quiet = add(6, 9);
  tr.publish(disputed, user(1));
  tr.publish(quiet, user(1));
  vote(disputed, 2, 1);
  vote(disputed, 3, 1);
  vote(disputed, 4, -1); // 67% — below 80%, stays open until the deadline
  vote(quiet, 2, 1);
  assert.equal(status(disputed), 'voting');
  db.exec("UPDATE proposals SET closes_at = datetime('now', '-1 minute')");
  tr.sweep();
  assert.equal(status(disputed), 'rejected');
  assert.equal(status(quiet), 'draft');
  assert.match(tr.get(quiet).decision_note, /без кворума/);
});
