// @ts-check
// A request budget per address for those not signed in (a guest reading by a shared link, the sign-in
// page, anyone knocking): a bucket of `burst` requests refilled at `perMinute`. Reading is far below it —
// a paper is two requests; what goes over it is a script, answered 429 until the bucket refills.
// Signed-in people are not counted. In memory: one process (HOSTING.md, «Ограничения масштабирования»).

/** @param {{ perMinute?: number, burst?: number, now?: () => number }} [opts] */
export function createRateLimit({ perMinute = 120, burst = 60, now = Date.now } = {}) {
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map();
  const rate = perMinute / 60_000;
  let swept = now();
  return {
    /** Takes one request from the address's budget. @param {string} key @returns {boolean} false — over it */
    take(key) {
      const t = now();
      // the full buckets are dropped now and then (they are the same as no bucket)
      if (t - swept > 10 * 60_000) {
        for (const [k, b] of buckets) if (b.tokens + (t - b.at) * rate >= burst) buckets.delete(k);
        swept = t;
      }
      const b = buckets.get(key) ?? { tokens: burst, at: t };
      b.tokens = Math.min(burst, b.tokens + (t - b.at) * rate);
      b.at = t;
      buckets.set(key, b);
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
  };
}
