// A small in-memory sliding-window limiter, keyed per session (#47). It caps how fast one signed-in
// person can hit the place search; it is a guard rail, not a security boundary, so per-instance memory
// is enough for a single-user app.

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export type RateDecision = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  consume(key: string): RateDecision;
}

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    consume(key) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((at) => time - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: windowMs - (time - recent[0]) };
      }
      recent.push(time);
      hits.set(key, recent);
      // Drop idle keys so the map cannot grow without bound.
      for (const [other, stamps] of hits) {
        if (other !== key && stamps.every((at) => time - at >= windowMs)) hits.delete(other);
      }
      return { ok: true };
    },
  };
}
