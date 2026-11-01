import { describe, expect, it, vi } from "vitest";
import { fetchTripWeather } from "./weather-client";

describe("fetchTripWeather", () => {
  it("requests the owner-only endpoint without caching and returns its stop rows", async () => {
    const doFetch = vi.fn(async () =>
      Response.json({ weather: [{ stopIndex: 0, status: "unavailable", days: [] }] }),
    );
    await expect(
      fetchTripWeather("trip id", doFetch as typeof fetch, "2026-06-01"),
    ).resolves.toEqual({
      kind: "ready",
      stops: [{ stopIndex: 0, status: "unavailable", days: [] }],
    });
    expect(doFetch).toHaveBeenCalledWith("/api/weather?tripId=trip%20id&today=2026-06-01", {
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("sends the device's local date by default (#361)", async () => {
    const doFetch = vi.fn(async () => Response.json({ weather: [] }));
    vi.useFakeTimers();
    try {
      // 23:30 on 5 Jun local time, whatever the UTC date is.
      vi.setSystemTime(new Date(2026, 5, 5, 23, 30));
      await fetchTripWeather("t", doFetch as typeof fetch);
    } finally {
      vi.useRealTimers();
    }
    expect(doFetch).toHaveBeenCalledWith(
      "/api/weather?tripId=t&today=2026-06-05",
      expect.anything(),
    );
  });

  it("turns HTTP and malformed responses into unavailable", async () => {
    await expect(
      fetchTripWeather(
        "trip",
        vi.fn(async () => new Response(null, { status: 500 })) as typeof fetch,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      fetchTripWeather("trip", vi.fn(async () => Response.json({ weather: [{}] })) as typeof fetch),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      fetchTripWeather("trip", vi.fn(async () => Response.json({ nope: [] })) as typeof fetch),
    ).resolves.toEqual({ kind: "unavailable" });
    // Rows that are not objects at all.
    await expect(
      fetchTripWeather(
        "trip",
        vi.fn(async () => Response.json({ weather: [null, 3] })) as typeof fetch,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("distinguishes an offline fetch failure from another network failure", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    });
    const down = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(fetchTripWeather("trip", down as typeof fetch)).resolves.toEqual({
      kind: "offline",
    });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    await expect(fetchTripWeather("trip", down as typeof fetch)).resolves.toEqual({
      kind: "unavailable",
    });
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
});
