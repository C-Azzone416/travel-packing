import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StopWeather } from "@/domain/weather/types";
import { createRateLimiter } from "@/server/locations/rate-limit";
import type { WeatherProvider } from "./provider";
import { handleWeatherRequest, type StopsSource } from "./request-handler";
import { setWeatherLogSink } from "./safe-log";

const mappedStop = {
  stopIndex: 0,
  arrive: "2026-06-01",
  leave: "2026-06-02",
  includeLeave: false,
  latitude: 1,
  longitude: 2,
};
const customStop = {
  stopIndex: 1,
  arrive: "2026-06-02",
  leave: "2026-06-03",
  includeLeave: true,
};
const weather: StopWeather = {
  stopIndex: 0,
  status: "ok",
  days: [
    {
      date: "2026-06-01",
      stopIndex: 0,
      source: "forecast",
      highC: 22,
      lowC: 12,
      precipProbability: 0.1,
      precipMm: 0,
      snowCm: 0,
      uvIndexMax: 4,
      sunshineHours: 8,
    },
  ],
};
const TRIP_ID = "123e4567-e89b-42d3-a456-426614174000";

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  setWeatherLogSink((line) => logs.push(line));
});

function setup({ optedIn = true, limit = 10 }: { optedIn?: boolean; limit?: number } = {}) {
  const source: StopsSource = {
    loadWeatherTrip: vi.fn(async () => ({ optedIn, stops: [mappedStop, customStop] })),
  };
  const provider: WeatherProvider = {
    getStopWeather: vi.fn(async () => weather),
  };
  const limiter = createRateLimiter({ limit, windowMs: 60_000, now: () => 0 });
  const call = (tripId: string | null = TRIP_ID, ownerId = "owner_1") =>
    handleWeatherRequest(tripId, ownerId, { source, provider, limiter });
  return { source, provider, limiter, call };
}

describe("handleWeatherRequest", () => {
  it("loads only the owner's trip and skips the provider for custom stops", async () => {
    const { source, provider, call } = setup();
    expect(await call()).toEqual({
      status: 200,
      body: {
        weather: [weather, { stopIndex: 1, status: "unavailable", days: [] }],
      },
    });
    expect(source.loadWeatherTrip).toHaveBeenCalledWith("owner_1", TRIP_ID);
    expect(provider.getStopWeather).toHaveBeenCalledTimes(1);
    expect(provider.getStopWeather).toHaveBeenCalledWith(
      mappedStop,
      expect.objectContaining({
        signal: undefined,
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("passes the device's local date to the provider only when it is within a day of the server's date (#361)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    try {
      const askWith = async (rawToday: string | null | undefined) => {
        const { provider, source, limiter } = setup();
        await handleWeatherRequest(
          TRIP_ID,
          "owner_1",
          { source, provider, limiter },
          undefined,
          rawToday,
        );
        return vi.mocked(provider.getStopWeather).mock.calls[0][1];
      };
      expect(await askWith("2026-05-31")).toMatchObject({ today: "2026-05-31" });
      expect(await askWith("2026-06-02")).toMatchObject({ today: "2026-06-02" });
      expect(await askWith("2026-06-04")).toMatchObject({ today: "2026-06-01" });
      expect(await askWith("junk")).toMatchObject({ today: "2026-06-01" });
      expect(await askWith(null)).toMatchObject({ today: "2026-06-01" });
      expect(await askWith(undefined)).toMatchObject({ today: "2026-06-01" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does no provider work until the owner opts in", async () => {
    const { provider, call } = setup({ optedIn: false });
    expect(await call()).toEqual({ status: 200, body: { weather: [] } });
    expect(provider.getStopWeather).not.toHaveBeenCalled();
    expect(logs.at(-1)).toContain("opted-out");
  });

  it.each([null, "", "with spaces", "x".repeat(101), "slash/no", "trip_1"])(
    "rejects invalid trip id %j without loading anything",
    async (tripId) => {
      const { source, provider, call } = setup();
      expect(await call(tripId)).toEqual({ status: 400, body: { error: "invalid-trip" } });
      expect(source.loadWeatherTrip).not.toHaveBeenCalled();
      expect(provider.getStopWeather).not.toHaveBeenCalled();
    },
  );

  it("does not reveal whether a missing or differently-owned trip exists", async () => {
    const { source, provider, call } = setup();
    vi.mocked(source.loadWeatherTrip).mockResolvedValue(null);
    expect(await call("123e4567-e89b-42d3-a456-426614174001")).toEqual({
      status: 404,
      body: { error: "not-found" },
    });
    expect(provider.getStopWeather).not.toHaveBeenCalled();
  });

  it("rate limits per owner before loading a trip", async () => {
    const { source, call } = setup({ limit: 1 });
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited).toEqual({
      status: 429,
      body: { error: "rate-limited" },
      retryAfterSeconds: 60,
    });
    expect(source.loadWeatherTrip).toHaveBeenCalledTimes(1);
  });

  it("contains a provider failure to the affected stop", async () => {
    const { provider, call } = setup();
    vi.mocked(provider.getStopWeather).mockRejectedValue(new Error("coordinates and dates"));
    expect(await call()).toEqual({
      status: 200,
      body: {
        weather: [
          { stopIndex: 0, status: "unavailable", days: [] },
          { stopIndex: 1, status: "unavailable", days: [] },
        ],
      },
    });
    expect(logs.join("\n")).not.toContain("coordinates");
  });
});
