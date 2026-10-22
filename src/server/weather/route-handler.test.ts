import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";
import { setAuthLogSink } from "@/server/auth/safe-log";
import { createRateLimiter } from "@/server/locations/rate-limit";
import type { WeatherProvider } from "./provider";
import type { StopsSource } from "./request-handler";
import { createWeatherRoute } from "./route-handler";
import { setWeatherLogSink } from "./safe-log";

const OWNER = { email: "owner@example.test", password: "pw", userId: "owner_1" };
const TRIP_ID = "123e4567-e89b-42d3-a456-426614174000";
let logs: string[] = [];

beforeEach(() => {
  logs = [];
  setAuthLogSink((line) => logs.push(line));
  setWeatherLogSink((line) => logs.push(line));
});
afterEach(() => {
  setAuthLogSink();
  setWeatherLogSink();
});

async function setup({
  signedInAs = OWNER.email,
  limit = 10,
}: { signedInAs?: string | null; limit?: number } = {}) {
  const auth = createFakeAuth([
    OWNER,
    { email: "intruder@example.test", password: "pw", userId: "intruder_1" },
  ]);
  if (signedInAs) await auth.signInWithPassword(signedInAs, "pw");
  const source: StopsSource = {
    loadWeatherTrip: vi.fn(async () => ({ optedIn: true, stops: [] })),
  };
  const provider: WeatherProvider = { getStopWeather: vi.fn() };
  const GET = createWeatherRoute({
    getAuth: async () => ({ provider: auth, allowlist: parseAllowlist(OWNER.email) }),
    source,
    provider,
    limiter: createRateLimiter({ limit, windowMs: 60_000, now: () => 0 }),
  });
  const call = (tripId = TRIP_ID) =>
    GET(new Request(`http://app.test/api/weather?tripId=${encodeURIComponent(tripId)}`));
  return { source, provider, call };
}

describe("GET /api/weather", () => {
  it("returns owner-scoped weather without browser or framework caching", async () => {
    const { source, call } = await setup();
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ weather: [] });
    expect(source.loadWeatherTrip).toHaveBeenCalledWith("owner_1", TRIP_ID);
  });

  it("refuses signed-out and non-owner sessions before loading data", async () => {
    const signedOut = await setup({ signedInAs: null });
    const unauthenticated = await signedOut.call();
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: "unauthenticated" });
    expect(signedOut.source.loadWeatherTrip).not.toHaveBeenCalled();

    const intruder = await setup({ signedInAs: "intruder@example.test" });
    const forbidden = await intruder.call();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    expect(intruder.source.loadWeatherTrip).not.toHaveBeenCalled();
  });

  it("sets Retry-After and returns a generic rate-limit body", async () => {
    const { call } = await setup({ limit: 1 });
    expect((await call()).status).toBe(200);
    const response = await call();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate-limited" });
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("contains unexpected data-source failures and never exposes their details", async () => {
    const { source, call } = await setup();
    vi.mocked(source.loadWeatherTrip).mockRejectedValue(new Error("Secret Place 2026-06-01 12.34"));
    const response = await call();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("Secret Place");
    expect(logs.join("\n")).not.toContain("Secret Place");
  });
});
