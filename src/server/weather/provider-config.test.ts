import { describe, expect, it, vi } from "vitest";
import { openMeteoWeatherEnabled, selectWeatherProvider, weatherBaseUrls } from "./provider-config";

const stop = {
  stopIndex: 0,
  arrive: "2026-06-01",
  leave: "2026-06-02",
  includeLeave: false,
  latitude: 1,
  longitude: 2,
};

describe("weather provider config", () => {
  it("enables external requests only for the exact open-meteo value", async () => {
    expect(openMeteoWeatherEnabled({ WEATHER_PROVIDER: "open-meteo" })).toBe(true);
    expect(openMeteoWeatherEnabled({ WEATHER_PROVIDER: "fake" })).toBe(false);
    expect(openMeteoWeatherEnabled({ WEATHER_PROVIDER: "OPEN-METEO" })).toBe(false);
    const fetcher = vi.fn<typeof fetch>();
    const provider = selectWeatherProvider(
      { WEATHER_PROVIDER: "fake" },
      fetcher,
      () => new Date("2026-06-01T12:00:00Z"),
    );
    const result = await provider.getStopWeather(stop);
    expect(result.status).toBe("ok");
    expect(result.days[0]).toMatchObject({ source: "forecast", stopIndex: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows provider URL overrides only in a non-Vercel e2e build", () => {
    const overrides = {
      NEXT_PUBLIC_E2E_BUILD: "1",
      OPEN_METEO_FORECAST_URL: "http://127.0.0.1/forecast",
      OPEN_METEO_ARCHIVE_URL: "http://127.0.0.1/archive",
    };
    expect(weatherBaseUrls(overrides)).toEqual({
      forecastUrl: "http://127.0.0.1/forecast",
      archiveUrl: "http://127.0.0.1/archive",
    });
    expect(weatherBaseUrls({ ...overrides, VERCEL: "1" })).toEqual({});
    expect(weatherBaseUrls({ ...overrides, NEXT_PUBLIC_E2E_BUILD: "0" })).toEqual({});
  });

  it("selects the real adapter only when explicitly enabled", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        daily: {
          time: ["2026-06-01"],
          temperature_2m_max: [20],
          temperature_2m_min: [10],
          precipitation_probability_max: [0],
          precipitation_sum: [0],
          snowfall_sum: [0],
          uv_index_max: [3],
          sunshine_duration: [3600],
        },
      }),
    );
    const provider = selectWeatherProvider(
      { WEATHER_PROVIDER: "open-meteo" },
      fetcher,
      () => new Date("2026-06-01T00:00:00Z"),
    );
    expect(await provider.getStopWeather(stop)).toMatchObject({ status: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable fake weather for a custom stop", async () => {
    const provider = selectWeatherProvider({}, vi.fn(), () => new Date("2026-06-01T00:00:00Z"));
    expect(await provider.getStopWeather({ ...stop, latitude: undefined })).toEqual({
      stopIndex: 0,
      status: "unavailable",
      days: [],
    });
  });
});
