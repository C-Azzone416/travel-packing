import { describe, expect, it } from "vitest";
import { createFakeWeatherProvider } from "./fake";

const now = () => new Date("2026-06-01T00:00:00Z");
const base = {
  stopIndex: 1,
  arrive: "2026-06-01",
  leave: "2026-06-05",
  includeLeave: false,
  latitude: 1,
  longitude: 2,
};

describe("fake weather provider", () => {
  it("is deterministic, date-relative and covers wet and dry forecast days", async () => {
    const provider = createFakeWeatherProvider(now);
    const first = await provider.getStopWeather(base);
    const second = await provider.getStopWeather(base);
    expect(second).toEqual(first);
    expect(first.days).toHaveLength(4);
    expect(first.days.every((day) => day.source === "forecast")).toBe(true);
    expect(new Set(first.days.map((day) => day.precipMm))).toEqual(new Set([0, 4]));
    expect(first.days.every((day) => day.uvIndexMax === 4)).toBe(true);
  });

  it("labels dates outside the 16-day window typical and includes the final day", async () => {
    const provider = createFakeWeatherProvider(now);
    const result = await provider.getStopWeather({
      ...base,
      arrive: "2026-07-01",
      leave: "2026-07-02",
      includeLeave: true,
    });
    expect(result.days.map((day) => day.date)).toEqual(["2026-07-01", "2026-07-02"]);
    expect(result.days.every((day) => day.source === "typical" && day.uvIndexMax === null)).toBe(
      true,
    );
  });

  it("splits forecast from typical by the device date, clamped to the provider's GMT window (#361)", async () => {
    // GMT is the 1st; a UTC+10 device is already on the 2nd. Its 17th day is beyond what is forecast.
    const provider = createFakeWeatherProvider(now);
    const result = await provider.getStopWeather(
      { ...base, arrive: "2026-06-01", leave: "2026-06-17", includeLeave: true },
      { today: "2026-06-02" },
    );
    const sources = Object.fromEntries(result.days.map((day) => [day.date, day.source]));
    expect(sources["2026-06-01"]).toBe("typical");
    expect(sources["2026-06-02"]).toBe("forecast");
    expect(sources["2026-06-16"]).toBe("forecast");
    expect(sources["2026-06-17"]).toBe("typical");
  });

  it("fails closed for either missing coordinate or malformed dates", async () => {
    const provider = createFakeWeatherProvider(now);
    for (const input of [
      { ...base, latitude: undefined },
      { ...base, longitude: undefined },
      { ...base, arrive: "bad" },
    ]) {
      expect(await provider.getStopWeather(input)).toEqual({
        stopIndex: 1,
        status: "unavailable",
        days: [],
      });
    }
  });
});
