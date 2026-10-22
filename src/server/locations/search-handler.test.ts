import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import { createRateLimiter } from "./rate-limit";
import {
  handleSearch,
  logLocationEvent,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  setLocationLogSink,
} from "./search-handler";

const place: SampleLocation = {
  id: "open-meteo-1",
  city: "London",
  region: "England",
  country: "United Kingdom",
  countryCode: "GB",
  label: "London, England, United Kingdom",
};

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  setLocationLogSink((line) => lines.push(line));
});
afterEach(() => setLocationLogSink());

function setup(limit = 5) {
  const search = vi.fn<
    (query: string, options: { signal?: AbortSignal }) => Promise<SampleLocation[]>
  >(async () => [place]);
  let time = 0;
  const limiter = createRateLimiter({ limit, windowMs: 60_000, now: () => time });
  return { search, limiter, deps: { search, limiter }, advance: (ms: number) => (time += ms) };
}

describe("handleSearch", () => {
  it("returns places for a valid query, searching for the trimmed text only", async () => {
    const { search, deps } = setup();
    expect(await handleSearch("  London ", "session-1", deps)).toEqual({
      status: 200,
      body: { places: [place] },
    });
    expect(search).toHaveBeenCalledWith("London", { signal: undefined });
  });

  it("passes the request's abort signal on", async () => {
    const { search, deps } = setup();
    const controller = new AbortController();
    await handleSearch("London", "s", deps, controller.signal);
    expect(search.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it.each([[null], [""], ["   "], ["a"], [" b "], ["x".repeat(MAX_QUERY_LENGTH + 1)]])(
    "rejects %j as an invalid query without searching or using the allowance",
    async (query) => {
      const { search, deps, limiter } = setup(1);
      expect(await handleSearch(query, "s", deps)).toEqual({
        status: 400,
        body: { error: "invalid-query" },
      });
      expect(search).not.toHaveBeenCalled();
      expect(limiter.consume("s").ok).toBe(true);
    },
  );

  it("accepts the shortest and the longest allowed query", async () => {
    const { deps } = setup();
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(MAX_QUERY_LENGTH).toBe(50);
    expect((await handleSearch("ab", "s", deps)).status).toBe(200);
    expect((await handleSearch("x".repeat(50), "s", deps)).status).toBe(200);
  });

  it("rate limits per session, telling the caller how long to wait (at least a second)", async () => {
    const { deps, advance } = setup(2);
    await handleSearch("London", "a", deps);
    await handleSearch("London", "a", deps);
    advance(59_500);
    expect(await handleSearch("London", "a", deps)).toEqual({
      status: 429,
      body: { error: "rate-limited" },
      retryAfterSeconds: 1,
    });
    expect((await handleSearch("London", "b", deps)).status).toBe(200);
    advance(500);
    expect((await handleSearch("London", "a", deps)).status).toBe(200);
  });

  it("rounds the wait up to whole seconds", async () => {
    const { deps, advance } = setup(1);
    await handleSearch("London", "a", deps);
    advance(10_000);
    expect(await handleSearch("London", "a", deps)).toMatchObject({
      status: 429,
      retryAfterSeconds: 50,
    });
  });

  it("answers 502 with a generic body, and no detail, when the provider fails", async () => {
    const { search, deps } = setup();
    search.mockRejectedValue(new Error("secret provider detail for London"));
    const response = await handleSearch("London", "s", deps);
    expect(response).toEqual({ status: 502, body: { error: "unavailable" } });
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("does not search at all for a rate-limited request", async () => {
    const { search, deps } = setup(1);
    await handleSearch("London", "a", deps);
    search.mockClear();
    await handleSearch("London", "a", deps);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("logging", () => {
  it("logs one closed event code per request, and never the query, a place or the session", async () => {
    const { search, deps } = setup(2);
    await handleSearch("SecretCityName", "session-SECRET", deps);
    await handleSearch("x", "session-SECRET", deps);
    await handleSearch("SecretCityName", "session-SECRET", deps);
    await handleSearch("SecretCityName", "session-SECRET", deps);
    search.mockRejectedValue(new Error("SecretCityName failed"));
    const other = setup();
    other.search.mockRejectedValue(new Error("SecretCityName failed"));
    await handleSearch("SecretCityName", "session-SECRET", other.deps);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { scope: "locations", event: "search" },
      { scope: "locations", event: "invalid-query" },
      { scope: "locations", event: "search" },
      { scope: "locations", event: "rate-limited" },
      { scope: "locations", event: "provider-error" },
    ]);
    const all = lines.join("\n");
    for (const secret of ["SecretCityName", "session-SECRET", "London", "England"])
      expect(all).not.toContain(secret);
  });

  it("writes to the console by default and restores that after a test sink", () => {
    setLocationLogSink();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logLocationEvent("search");
    expect(info).toHaveBeenCalledWith(JSON.stringify({ scope: "locations", event: "search" }));
    info.mockRestore();
  });
});
