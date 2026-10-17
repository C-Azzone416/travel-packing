import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, DEFAULT_SEARCHES_PER_MINUTE, searchesPerMinute } from "./rate-limit";

function setup(limit = 3, windowMs = 1000) {
  let time = 10_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => time });
  return { limiter, advance: (ms: number) => (time += ms) };
}

describe("createRateLimiter", () => {
  it("allows up to the limit, then refuses with how long to wait", () => {
    const { limiter, advance } = setup();
    expect(limiter.consume("a")).toEqual({ ok: true });
    advance(100);
    expect(limiter.consume("a")).toEqual({ ok: true });
    advance(100);
    expect(limiter.consume("a")).toEqual({ ok: true });
    advance(100);
    expect(limiter.consume("a")).toEqual({ ok: false, retryAfterMs: 700 });
  });

  it("lets requests through again as the window slides", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.consume("a");
    expect(limiter.consume("a").ok).toBe(false);
    advance(999);
    expect(limiter.consume("a").ok).toBe(false);
    advance(1);
    expect(limiter.consume("a")).toEqual({ ok: true });
  });

  it("does not count refused requests against the caller", () => {
    const { limiter, advance } = setup(1, 1000);
    expect(limiter.consume("a").ok).toBe(true);
    for (let i = 0; i < 5; i++) {
      advance(100);
      expect(limiter.consume("a").ok).toBe(false);
    }
    advance(600);
    expect(limiter.consume("a").ok).toBe(true);
  });

  it("keeps sessions independent", () => {
    const { limiter } = setup(1);
    expect(limiter.consume("a").ok).toBe(true);
    expect(limiter.consume("a").ok).toBe(false);
    expect(limiter.consume("b").ok).toBe(true);
  });

  it("forgets idle sessions", () => {
    const { limiter, advance } = setup(1, 1000);
    limiter.consume("idle");
    advance(5000);
    expect(limiter.consume("other").ok).toBe(true);
    expect(limiter.consume("idle").ok).toBe(true);
  });

  it("keeps a session that is still inside its window when pruning others", () => {
    const { limiter, advance } = setup(1, 1000);
    limiter.consume("busy");
    advance(500);
    limiter.consume("other");
    expect(limiter.consume("busy").ok).toBe(false);
  });

  it("uses the real clock by default", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.consume("x").ok).toBe(true);
    expect(limiter.consume("x").ok).toBe(false);
  });
});

describe("searchesPerMinute", () => {
  it("defaults to 20", () => {
    expect(DEFAULT_SEARCHES_PER_MINUTE).toBe(20);
    expect(searchesPerMinute({})).toBe(20);
  });

  it.each([
    ["1", 1],
    ["20", 20],
    [" 600 ", 600],
    ["10000", 10_000],
  ])("reads %j as %i", (raw, expected) => {
    expect(searchesPerMinute({ LOCATION_SEARCHES_PER_MINUTE: raw })).toBe(expected);
  });

  it.each([
    [""],
    ["  "],
    ["0"],
    ["-5"],
    ["1.5"],
    ["abc"],
    ["10001"],
    ["99999"],
    ["100000"],
    ["1e3"],
    ["20 searches"],
  ])("falls back to the default for %j, so a bad value never disables the limit", (raw) => {
    expect(searchesPerMinute({ LOCATION_SEARCHES_PER_MINUTE: raw })).toBe(20);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("LOCATION_SEARCHES_PER_MINUTE", "7");
    expect(searchesPerMinute()).toBe(7);
    vi.unstubAllEnvs();
  });
});
