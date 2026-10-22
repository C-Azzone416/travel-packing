import { describe, expect, it } from "vitest";
import type { TripStop } from "@/domain/trip-stops";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import { displayTemperature, hasCoordinates, weatherRowView } from "./weather-view";

const stop: TripStop = {
  location: {
    id: "place-a",
    city: "Harbor City",
    region: "Test",
    country: "Example",
    countryCode: "EX",
    label: "Harbor City",
    latitude: 12.34,
    longitude: 56.78,
  },
  arrive: "2031-04-03",
  leave: "2031-04-06",
};

const day = (over: Partial<DayWeather> = {}): DayWeather => ({
  date: "2031-04-03",
  stopIndex: 0,
  source: "forecast",
  highC: 20,
  lowC: 10,
  precipProbability: 0,
  precipMm: 0,
  snowCm: 0,
  uvIndexMax: 2,
  sunshineHours: 4,
  ...over,
});

describe("weather view", () => {
  it("converts and rounds display temperatures without changing engine units", () => {
    expect(displayTemperature(20, "C")).toBe(20);
    expect(displayTemperature(20, "F")).toBe(68);
    expect(displayTemperature(20.4, "C")).toBe(20);
  });

  it("summarizes a stop, including majority source, ranges, rain and snow", () => {
    const weather: StopWeather = {
      stopIndex: 0,
      status: "ok",
      days: [
        day({ highC: 21, lowC: 9, precipProbability: 0.4 }),
        day({ date: "2031-04-04", source: "typical", highC: 25, lowC: 12, snowCm: 1 }),
      ],
    };
    expect(weatherRowView(stop, weather)).toEqual({
      stopIndex: 0,
      city: "Harbor City",
      dates: "Apr 3–6",
      nights: 3,
      source: "forecast",
      mixed: true,
      high: 25,
      low: 9,
      rainDays: 1,
      totalDays: 2,
      glyph: "snow",
    });
  });

  it("uses typical when it is the majority and returns null without usable days", () => {
    const typical = {
      stopIndex: 0,
      status: "ok" as const,
      days: [day({ source: "typical", precipProbability: 0.5 })],
    };
    expect(weatherRowView(stop, typical)).toMatchObject({ source: "typical", glyph: "rain" });
    expect(weatherRowView(stop, { stopIndex: 0, status: "unavailable", days: [] })).toBeNull();
    expect(weatherRowView(stop, { stopIndex: 0, status: "ok", days: [] })).toBeNull();
  });

  it("recognizes only finite coordinate pairs", () => {
    expect(hasCoordinates(stop)).toBe(true);
    expect(hasCoordinates({ ...stop, location: { ...stop.location, latitude: undefined } })).toBe(
      false,
    );
    expect(hasCoordinates({ ...stop, location: { ...stop.location, longitude: Number.NaN } })).toBe(
      false,
    );
  });
});
