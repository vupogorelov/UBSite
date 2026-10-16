// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimit } from './ratelimit.js';

test('the budget of those not signed in: a burst, then refilled over time; each address its own', () => {
  let t = 0;
  const limit = createRateLimit({ perMinute: 60, burst: 3, now: () => t });
  assert.deepEqual([limit.take('a'), limit.take('a'), limit.take('a'), limit.take('a')], [true, true, true, false]);
  assert.equal(limit.take('b'), true, 'another address is not affected');
  t += 1000; // one request a second comes back
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), false);
  t += 60 * 60_000; // long after: full again (and the bucket swept)
  assert.deepEqual([limit.take('a'), limit.take('a'), limit.take('a')], [true, true, true]);
});
