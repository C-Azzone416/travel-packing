import { describe, expect, it, vi } from "vitest";
import type { DataContext } from "@/server/data/context";
import { fail, ok } from "@/server/data/result";
import type { TripStop } from "@/domain/trip-stops";
import { createDataStopsSource, type WeatherDataApi } from "./data-source";

const context = {} as DataContext;
const stops: TripStop[] = [
  {
    arrive: "2026-06-01",
    leave: "2026-06-03",
    location: {
      id: "private-place-id",
      city: "Private Place Name",
      region: "Region",
      country: "Country",
      countryCode: "CC",
      label: "Private Place Name, Country",
      latitude: 12.34,
      longitude: 56.78,
    },
  },
  {
    arrive: "2026-06-03",
    leave: "2026-06-05",
    location: {
      id: "custom",
      city: "Custom Place",
      region: "",
      country: "",
      countryCode: "",
      label: "Custom Place",
    },
  },
];

function api(overrides: Partial<WeatherDataApi> = {}): WeatherDataApi {
  return {
    getTrip: vi.fn(async () => ok({ stops })),
    getWeatherSettings: vi.fn(async () =>
      ok({ weatherOptIn: true, temperatureUnit: "F" as const }),
    ),
    ...overrides,
  };
}

describe("data StopsSource", () => {
  it("loads through the owner-authorized service and strips every place identifier and name", async () => {
    const service = api();
    const source = createDataStopsSource(async () => context, service);
    const result = await source.loadWeatherTrip("owner-from-auth", "trip-id");
    expect(service.getTrip).toHaveBeenCalledWith(context, { tripId: "trip-id" });
    expect(service.getWeatherSettings).toHaveBeenCalledWith(context);
    expect(result).toEqual({
      optedIn: true,
      stops: [
        {
          stopIndex: 0,
          arrive: "2026-06-01",
          leave: "2026-06-03",
          includeLeave: false,
          latitude: 12.34,
          longitude: 56.78,
        },
        {
          stopIndex: 1,
          arrive: "2026-06-03",
          leave: "2026-06-05",
          includeLeave: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Private Place Name");
    expect(JSON.stringify(result)).not.toContain("private-place-id");
  });

  it("returns null for a missing/invalid owner-scoped trip and hides other failures", async () => {
    const missing = createDataStopsSource(
      async () => context,
      api({ getTrip: vi.fn(async () => fail("NOT_FOUND")) }),
    );
    expect(await missing.loadWeatherTrip("owner", "trip")).toBeNull();

    const invalid = createDataStopsSource(
      async () => context,
      api({ getTrip: vi.fn(async () => fail("INVALID_INPUT")) }),
    );
    expect(await invalid.loadWeatherTrip("owner", "trip")).toBeNull();

    const denied = createDataStopsSource(
      async () => context,
      api({ getTrip: vi.fn(async () => fail("FORBIDDEN")) }),
    );
    await expect(denied.loadWeatherTrip("owner", "trip")).rejects.toThrow(
      "weather data unavailable",
    );
  });

  it("fails closed when runtime or settings are unavailable", async () => {
    const noContext = createDataStopsSource(async () => null, api());
    await expect(noContext.loadWeatherTrip("owner", "trip")).rejects.toThrow(
      "weather data unavailable",
    );

    const noSettings = createDataStopsSource(
      async () => context,
      api({ getWeatherSettings: vi.fn(async () => fail("INTERNAL")) }),
    );
    await expect(noSettings.loadWeatherTrip("owner", "trip")).rejects.toThrow(
      "weather data unavailable",
    );
  });
});
