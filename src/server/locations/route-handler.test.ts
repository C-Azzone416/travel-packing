import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import { parseAllowlist } from "@/server/auth/allowlist";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { setAuthLogSink } from "@/server/auth/safe-log";
import { createRateLimiter } from "./rate-limit";
import type { SearchFn } from "./provider-config";
import { createSearchRoute } from "./route-handler";
import { setLocationLogSink } from "./search-handler";

const OWNER = { email: "owner@example.test", password: "pw", userId: "user-1" };
const place: SampleLocation = {
  id: "p1",
  city: "London",
  region: "England",
  country: "United Kingdom",
  countryCode: "GB",
  label: "London, England, United Kingdom",
};

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  setLocationLogSink((line) => logs.push(line));
  setAuthLogSink((line) => logs.push(line));
});
afterEach(() => {
  setLocationLogSink();
  setAuthLogSink();
});

async function setup({
  signedInAs = OWNER.email,
  limit = 20,
}: { signedInAs?: string | null; limit?: number } = {}) {
  const auth = createFakeAuth([
    OWNER,
    { email: "intruder@example.test", password: "pw", userId: "user-2" },
  ]);
  if (signedInAs) await auth.signInWithPassword(signedInAs, "pw");
  const search = vi.fn<SearchFn>(async () => [place]);
  const limiter = createRateLimiter({ limit, windowMs: 60_000 });
  const GET = createSearchRoute({
    getAuth: async () => ({ provider: auth, allowlist: parseAllowlist(OWNER.email) }),
    search,
    limiter,
  });
  const call = (q?: string) =>
    GET(
      new Request(
        `http://app.test/api/locations/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
      ),
    );
  return { auth, search, call };
}

describe("GET /api/locations/search", () => {
  it("returns the places for the signed-in owner, uncached", async () => {
    const { call, search } = await setup();
    const response = await call("London");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ places: [place] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(search).toHaveBeenCalledWith(
      "London",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refuses a signed-out request with 401 and never searches", async () => {
    const { call, search } = await setup({ signedInAs: null });
    const response = await call("London");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(search).not.toHaveBeenCalled();
  });

  it("refuses a signed-in person who is not on the allowlist with 403, a generic body, and never searches", async () => {
    const { call, search } = await setup({ signedInAs: "intruder@example.test" });
    const response = await call("London");
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "forbidden" });
    expect(text).not.toContain("intruder");
    expect(search).not.toHaveBeenCalled();
  });

  it.each([[undefined], [""], ["a"], ["x".repeat(51)]])(
    "answers 400 for the query %j",
    async (query) => {
      const { call, search } = await setup();
      const response = await call(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid-query" });
      expect(search).not.toHaveBeenCalled();
    },
  );

  it("rate limits per session with 429 and a Retry-After header", async () => {
    const { call } = await setup({ limit: 2 });
    expect((await call("London")).status).toBe(200);
    expect((await call("London")).status).toBe(200);
    const limited = await call("London");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate-limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 502 with a generic body when the provider fails", async () => {
    const { call, search } = await setup();
    search.mockRejectedValue(new Error("provider secret for London"));
    const response = await call("London");
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("secret");
  });

  it("answers 500 with a generic body for an unexpected failure (e.g. the auth runtime itself failing)", async () => {
    const GET = createSearchRoute({
      getAuth: async () => Promise.reject(new Error("boom with owner@example.test")),
      search: async () => [],
      limiter: createRateLimiter({ limit: 1, windowMs: 1000 }),
    });
    const response = await GET(new Request("http://app.test/api/locations/search?q=London"));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("owner@");
  });

  it("never writes the query, the place, the session or the email to any log", async () => {
    const { call, search } = await setup();
    await call("SecretCityName");
    await call("x");
    search.mockRejectedValue(new Error("SecretCityName failed"));
    await call("SecretCityName");
    const all = logs.join("\n");
    expect(all).not.toContain("SecretCityName");
    expect(all).not.toContain("user-1");
    expect(all).not.toContain(OWNER.email);
    expect(all).not.toContain("London");
    expect(logs.length).toBeGreaterThan(0);
  });
});
