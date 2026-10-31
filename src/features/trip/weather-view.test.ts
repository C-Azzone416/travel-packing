import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripStop } from "@/domain/trip-stops";
import { localToday } from "@/lib/today";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import {
  dayCount,
  dayView,
  displayTemperature,
  hasCoordinates,
  rainLine,
  typicalLine,
  weatherRowView,
} from "./weather-view";

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

afterEach(() => vi.useRealTimers());

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
      forecastDays: [
        {
          date: "2031-04-03",
          label: "Thu Apr 3",
          parts: { weekday: "Thu", month: "Apr", day: 3 },
          spoken: "Thursday 3 April: rain likely, high 21, low 9, 40% chance of rain",
          glyph: "rain",
          high: 21,
          low: 9,
          rainPercent: 40,
        },
      ],
      forecast: { high: 21, low: 9, rainDays: 1, totalDays: 1 },
      typical: { high: 25, low: 12, rainDays: 0, totalDays: 1 },
      typicalRange: "Apr 4",
      typicalPlacement: "after",
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

  describe("daily forecast split (#303)", () => {
    const view = (days: DayWeather[], unit: "C" | "F" = "C", today = "2031-04-01") =>
      weatherRowView(stop, { stopIndex: 0, status: "ok", days }, unit, today)!;
    const at = (date: string, over: Partial<DayWeather> = {}) => day({ date, ...over });

    it("an all-typical stay has no forecast part and a typical summary over every day", () => {
      const v = view([
        at("2031-06-03", { source: "typical", highC: 22 }),
        at("2031-06-04", { source: "typical", lowC: 5 }),
      ]);
      expect(v.forecastDays).toEqual([]);
      expect(v.forecast).toBeNull();
      expect(v.typical).toEqual({ high: 22, low: 5, rainDays: 0, totalDays: 2 });
    });

    it("an all-forecast stay has no typical part", () => {
      const v = view([at("2031-04-02"), at("2031-04-03", { precipProbability: 0.4 })]);
      expect(v.typical).toBeNull();
      expect(v.forecast).toEqual({ high: 20, low: 10, rainDays: 1, totalDays: 2 });
      expect(v.forecastDays.map((entry) => entry.date)).toEqual(["2031-04-02", "2031-04-03"]);
    });

    it("a straddling stay keeps forecast and typical numbers apart", () => {
      const v = view([
        at("2031-04-03", { source: "forecast", highC: 18, lowC: 11, precipProbability: 0.2 }),
        at("2031-04-02", { source: "forecast", highC: 20, lowC: 12, precipProbability: 0.9 }),
        at("2031-04-20", { source: "typical", highC: 30, lowC: 1, precipProbability: 0.9 }),
      ]);
      // chronological even if the provider sent them out of order
      expect(v.forecastDays.map((entry) => entry.date)).toEqual(["2031-04-02", "2031-04-03"]);
      expect(v.forecast).toEqual({ high: 20, low: 11, rainDays: 1, totalDays: 2 });
      expect(v.typical).toEqual({ high: 30, low: 1, rainDays: 1, totalDays: 1 });
    });

    it("an in-progress stay puts past and later typical days in one typical summary", () => {
      const v = view([
        at("2031-03-30", { source: "typical", highC: 10 }),
        at("2031-04-01"),
        at("2031-04-25", { source: "typical", highC: 28 }),
      ]);
      expect(v.forecastDays).toHaveLength(1);
      expect(v.typical).toMatchObject({ high: 28, totalDays: 2 });
    });

    it("places an unbroken run of typical days after the window, before it, or split (#357)", () => {
      const after = view([
        at("2031-04-14"),
        at("2031-04-15"),
        at("2031-04-16", { source: "typical" }),
        at("2031-04-17", { source: "typical" }),
      ]);
      expect(after).toMatchObject({ typicalRange: "Apr 16–17", typicalPlacement: "after" });
      const before = view([
        at("2031-03-30", { source: "typical" }),
        at("2031-03-31", { source: "typical" }),
        at("2031-04-01"),
      ]);
      expect(before).toMatchObject({ typicalRange: "Mar 30–31", typicalPlacement: "before" });
      const single = view([at("2031-04-02"), at("2031-04-18", { source: "typical" })]);
      expect(single).toMatchObject({ typicalRange: "Apr 18", typicalPlacement: "after" });
      // across a month boundary, still one unbroken run
      const month = view([
        at("2031-04-02"),
        at("2031-04-30", { source: "typical" }),
        at("2031-05-01", { source: "typical" }),
      ]);
      expect(month).toMatchObject({ typicalRange: "Apr 30–May 1", typicalPlacement: "after" });
      // both sides of the window, or a gap, have no single range
      const both = view([
        at("2031-03-31", { source: "typical" }),
        at("2031-04-01"),
        at("2031-04-20", { source: "typical" }),
      ]);
      expect(both).toMatchObject({ typicalRange: null, typicalPlacement: "split" });
      const gap = view([
        at("2031-04-02"),
        at("2031-04-20", { source: "typical" }),
        at("2031-04-22", { source: "typical" }),
      ]);
      expect(gap).toMatchObject({ typicalRange: null, typicalPlacement: "split" });
      // no typical days: nothing to place
      expect(view([at("2031-04-02")])).toMatchObject({
        typicalRange: null,
        typicalPlacement: null,
      });
    });

    it("a single forecast day is one row", () => {
      expect(view([at("2031-04-05")]).forecastDays).toHaveLength(1);
    });

    it("builds the day view: UTC weekday with no timezone drift, Today, units, rounding", () => {
      const sunday = dayView(
        at("2031-04-06", { highC: 40, lowC: 31.4, precipProbability: 0.126 }),
        "F",
        "2031-04-01",
      );
      expect(sunday).toMatchObject({
        label: "Sun Apr 6",
        high: 104,
        low: 89,
        rainPercent: 13,
        glyph: "sun",
        spoken: "Sunday 6 April: sunny, high 104, low 89, 13% chance of rain",
      });
      expect(dayView(at("2031-04-01"), "C", "2031-04-01").label).toBe("Today Apr 1");
      // the parts feed the dashboard chip ("Fri 6") and phone row ("Fri Nov 6")
      expect(sunday.parts).toEqual({ weekday: "Sun", month: "Apr", day: 6 });
      expect(dayView(at("2031-04-01"), "C", "2031-04-01").parts).toEqual({
        weekday: "Today",
        month: "Apr",
        day: 1,
      });
      // a year boundary and a leap day
      expect(dayView(at("2032-01-01"), "C", "x").label).toBe("Thu Jan 1");
      expect(dayView(at("2032-02-29"), "C", "x").spoken).toContain("Sunday 29 February");
    });

    it("applies the stay glyph rules to one day: snow, then rain at 40%, else sun", () => {
      const glyph = (over: Partial<DayWeather>) => dayView(at("2031-04-02", over), "C", "x").glyph;
      expect(glyph({ snowCm: 1, precipProbability: 0.9 })).toBe("snow");
      expect(glyph({ snowCm: 0.9, precipProbability: 0.1 })).toBe("sun");
      expect(glyph({ precipProbability: 0.4 })).toBe("rain");
      expect(glyph({ precipProbability: 0.39 })).toBe("sun");
      expect(dayView(at("2031-04-02", { snowCm: 2 }), "C", "x").spoken).toContain("snow likely");
      expect(dayView(at("2031-04-02", { precipProbability: 0.5 }), "C", "x").spoken).toContain(
        "rain likely",
      );
    });

    it.each([
      ["America/Phoenix", "UTC-7"],
      ["Australia/Brisbane", "UTC+10"],
    ])("labels Today from the device's local date at local midnight in %s (%s)", (zone) => {
      const previous = process.env.TZ;
      process.env.TZ = zone;
      try {
        vi.useFakeTimers();
        const days = [at("2031-04-05"), at("2031-04-06")];
        const labels = () =>
          weatherRowView(stop, { stopIndex: 0, status: "ok", days })!.forecastDays.map(
            (d) => d.label,
          );
        // The local wall clock reads 23:59 on 5 Apr, then 00:00 on 6 Apr, whatever the UTC date is.
        vi.setSystemTime(new Date(2031, 3, 5, 23, 59, 59));
        expect(labels()).toEqual(["Today Apr 5", "Sun Apr 6"]);
        vi.setSystemTime(new Date(2031, 3, 6, 0, 0, 0));
        expect(labels()).toEqual(["Sat Apr 5", "Today Apr 6"]);
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    });

    it("defaults to Celsius and the clock's today", () => {
      const v = weatherRowView(stop, { stopIndex: 0, status: "ok", days: [at(localToday())] })!;
      expect(v.forecastDays[0].label.startsWith("Today")).toBe(true);
      expect(v.forecastDays[0].high).toBe(20);
    });
  });
});

describe("the shared forecast words (#357)", () => {
  const part = { high: 18, low: 11, rainDays: 0, totalDays: 2 };

  it("counts days with the right plural", () => {
    expect(dayCount(1)).toBe("1 day");
    expect(dayCount(2)).toBe("2 days");
  });

  it("says how many days it rains, or the dry line when none", () => {
    expect(rainLine({ ...part, rainDays: 1 }, "Rarely rains")).toBe("Rain on 1 of 2 days");
    expect(rainLine({ ...part, rainDays: 1, totalDays: 1 }, "x")).toBe("Rain on 1 of 1 day");
    expect(rainLine(part, "Rarely rains")).toBe("Rarely rains");
  });

  it("writes the typical line in the person's unit, with the dates only when given", () => {
    expect(typicalLine(part, "C")).toBe("Other 2 days: High 18° · Low 11° · Rarely rains");
    expect(typicalLine(part, "F")).toBe("Other 2 days: High 64° · Low 52° · Rarely rains");
    expect(typicalLine({ ...part, rainDays: 1 }, "C", "Nov 8–9")).toBe(
      "Other 2 days · Nov 8–9: High 18° · Low 11° · Rain on 1 of 2 days",
    );
    expect(typicalLine({ ...part, totalDays: 1 }, "C", null)).toBe(
      "Other 1 day: High 18° · Low 11° · Rarely rains",
    );
  });
});
