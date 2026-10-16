// @ts-check
// Every route of the API is held to shared/api-policy.js — what it does without a network:
// - no rule without a route: a route renamed would leave its rule matching nothing, and its changes
//   would stop waiting in the device's queue without a word;
// - the map of routes and their behaviour (api-policy.map.txt) is the one reviewed: a new route, or one
//   whose behaviour changed, fails here until the map is written anew (UPDATE_API_MAP=1 npm test) —
//   so whether it is live, kept, queued is decided, not left to the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { openDb } from './db.js';
import { createCore } from './core.js';
import { FEATURES } from './features/index.js';
import { readPolicy, writePolicy, API_RULES } from '../shared/api-policy.js';

const MAP = new URL('./api-policy.map.txt', import.meta.url);

/** Every route of every feature, with a path that fills its parameters. */
function routes() {
  process.env.UB_DB = ':memory:'; // (the search's worker opens its own database: not the real one)
  const core = createCore(openDb(':memory:'));
  for (const f of FEATURES) f.setup(core);
  return core.router.list().map((r) => ({ ...r, sample: r.path.replace(/:\w+/g, '1') }));
}

/** A route's behaviour without a network, as a word. @param {{ method: string, sample: string }} r */
function behaviour(r) {
  if (r.method === 'GET' || r.method === 'HEAD') return readPolicy(r.sample);
  const p = writePolicy(r.method, r.sample);
  return p.mode === 'queue' ? `queue ${p.kind}${p.merge ? ` (${p.merge})` : ''}` : p.mode;
}

test('no rule without a route: each rule of shared/api-policy.js matches a route of the server', () => {
  const all = routes();
  const lost = [
    ...API_RULES.READS.filter(([, re]) => !all.some((r) => r.method === 'GET' && re.test(r.sample))).map(([mode, re]) => `${mode} ${re}`),
    ...API_RULES.WRITES.filter(([m, re]) => !all.some((r) => r.method === m && re.test(r.sample))).map(([m, re]) => `${m} ${re}`),
  ];
  assert.deepEqual(lost, [], 'rules that match no route (a route renamed or gone?)');
});

test('the map of the API: every route, and what it does without a network, as reviewed', () => {
  const now = routes().map((r) => `${r.method} ${r.path} ${behaviour(r)}`).sort();
  if (process.env.UPDATE_API_MAP) {
    writeFileSync(MAP, `${now.join('\n')}\n`);
    return;
  }
  const kept = readFileSync(MAP, 'utf8').trim().split('\n');
  const added = now.filter((l) => !kept.includes(l));
  const gone = kept.filter((l) => !now.includes(l));
  assert.deepEqual({ added, gone }, { added: [], gone: [] },
    'the API changed: decide how the new routes behave without a network (shared/api-policy.js), then write the map anew: UPDATE_API_MAP=1 npm test');
});
