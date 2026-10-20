import { describe, expect, it, vi } from "vitest";
import { fetchTripWeather } from "./weather-client";

describe("fetchTripWeather", () => {
  it("requests the owner-only endpoint without caching and returns its stop rows", async () => {
    const doFetch = vi.fn(async () =>
      Response.json({ weather: [{ stopIndex: 0, status: "unavailable", days: [] }] }),
    );
    await expect(fetchTripWeather("trip id", doFetch as typeof fetch)).resolves.toEqual({
      kind: "ready",
      stops: [{ stopIndex: 0, status: "unavailable", days: [] }],
    });
    expect(doFetch).toHaveBeenCalledWith("/api/weather?tripId=trip%20id", {
      cache: "no-store",
      credentials: "same-origin",
    });
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
