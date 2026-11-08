import { describe, expect, it } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import { sampleLifecycleState } from "./fixtures";
import {
  fallbackReviewStop,
  hereStopIndex,
  remainingWeather,
  weatherForReview,
} from "@/features/trip/weather-remaining";
import {
  cityWeather,
  countdownFor,
  dayBadgeFor,
  homeModel,
  pendingByStop,
  weatherPillSub,
} from "./home-view";

// The Home while the trip is on (#410, spec #393 section 2.2). Every date is fixed: nothing here reads the clock.
const place = (city: string): SampleLocation => ({
  id: city.toLowerCase(),
  city,
  region: "",
  country: "",
  countryCode: "PT",
  label: city,
});
const stay = (city: string, arrive: string, leave: string): TripStop => ({
  location: place(city),
  arrive,
  leave,
});
// 10 nights, 11 days: Mar 14 - Mar 24. Lisbon Mar 14-17, Porto Mar 17-24.
const LISBON = stay("Lisbon", "2027-03-14", "2027-03-17");
const PORTO = stay("Porto", "2027-03-17", "2027-03-24");
const STOPS = [LISBON, PORTO];
const trip = (extra: Partial<LifecycleTrip> = {}): LifecycleTrip =>
  ({
    ...sampleLifecycleState().trips[0],
    id: "t1",
    start: "2027-03-14",
    end: "2027-03-24",
    stops: STOPS,
    origin: null,
    name: null,
    ...extra,
  }) as LifecycleTrip;

describe("dayBadgeFor", () => {
  it("is Day N of M from the day after the start, and Last day on the end date", () => {
    expect(dayBadgeFor(trip(), "2027-03-15")).toEqual({
      day: 2,
      of: 11,
      last: false,
      text: "Day 2 of 11",
    });
    expect(dayBadgeFor(trip(), "2027-03-23")?.text).toBe("Day 10 of 11");
    expect(dayBadgeFor(trip(), "2027-03-24")).toEqual({
      day: 11,
      of: 11,
      last: true,
      text: "Last day",
    });
  });

  it("has no badge before the trip, on its start day (Leaves today), or after its end date", () => {
    expect(dayBadgeFor(trip(), "2027-03-13")).toBeNull();
    expect(dayBadgeFor(trip(), "2027-03-14")).toBeNull();
    expect(dayBadgeFor(trip(), "2027-03-25")).toBeNull();
  });

  it("never badges a one-day trip: it is Leaves today, then past", () => {
    const day = trip({ start: "2027-03-14", end: "2027-03-14" });
    expect(dayBadgeFor(day, "2027-03-14")).toBeNull();
    expect(dayBadgeFor(day, "2027-03-15")).toBeNull();
  });

  it("is Last day (not Day 2 of 2) on the end date of a two-day trip", () => {
    const two = trip({ start: "2027-03-14", end: "2027-03-15" });
    expect(dayBadgeFor(two, "2027-03-15")?.text).toBe("Last day");
  });
});

describe("hereStopIndex", () => {
  it("is the stay containing today; on a changeover day the stay that begins wins", () => {
    expect(hereStopIndex(STOPS, "2027-03-15")).toBe(0);
    expect(hereStopIndex(STOPS, "2027-03-17")).toBe(1);
    expect(hereStopIndex(STOPS, "2027-03-23")).toBe(1);
  });

  it("is the last stay on its leave day, and nobody outside the trip", () => {
    expect(hereStopIndex(STOPS, "2027-03-24")).toBe(1);
    expect(hereStopIndex(STOPS, "2027-03-13")).toBeNull();
    expect(hereStopIndex(STOPS, "2027-03-25")).toBeNull();
    expect(hereStopIndex([], "2027-03-15")).toBeNull();
  });
});

describe("remaining weather", () => {
  const day = (date: string, stopIndex: number, rain = 0.1) => ({
    date,
    stopIndex,
    source: "forecast" as const,
    highC: 15,
    lowC: 10,
    precipProbability: rain,
    precipMm: 0,
    snowCm: 0,
    uvIndexMax: 3,
    sunshineHours: 5,
  });
  const weather: StopWeather[] = [
    {
      stopIndex: 0,
      status: "ok",
      days: ["2027-03-14", "2027-03-15", "2027-03-16"].map((d) => day(d, 0, 0.9)),
    },
    {
      stopIndex: 1,
      status: "ok",
      days: ["2027-03-17", "2027-03-18", "2027-03-19"].map((d) => day(d, 1)),
    },
  ];

  it("drops the days before today and keeps the stop indexes", () => {
    const ahead = remainingWeather(STOPS, weather, "2027-03-16");
    expect(ahead.map((s) => [s.stopIndex, s.days.map((d) => d.date)])).toEqual([
      [0, ["2027-03-16"]],
      [1, ["2027-03-17", "2027-03-18", "2027-03-19"]],
    ]);
  });

  it("drops a stay that is behind the person, even on its leave day", () => {
    const ahead = remainingWeather(STOPS, weather, "2027-03-17");
    expect(ahead.map((s) => s.stopIndex)).toEqual([1]);
    expect(ahead[0].days.map((d) => d.date)).toEqual(["2027-03-17", "2027-03-18", "2027-03-19"]);
  });

  it("keeps the last stay on the last day, though its leave day is today", () => {
    const last: StopWeather[] = [
      { stopIndex: 1, status: "ok", days: [day("2027-03-23", 1), day("2027-03-24", 1)] },
    ];
    const rows = cityWeather(STOPS, last, "C", "2027-03-24", true);
    expect(rows.map((r) => [r.city, r.here, r.tiles.map((t) => t.date)])).toEqual([
      ["Porto", true, ["2027-03-24"]],
    ]);
  });

  it("lists the stay the person is in first, says so, and leaves out the days and stays already gone", () => {
    const rows = cityWeather(STOPS, weather, "C", "2027-03-16", true);
    expect(rows.map((r) => [r.city, r.here, r.tiles.map((t) => t.date)])).toEqual([
      ["Lisbon", true, ["2027-03-16"]],
      ["Porto", false, ["2027-03-17", "2027-03-18", "2027-03-19"]],
    ]);
    // Lisbon rained on the 14th-16th; only today's rain is still ahead, and it says so.
    expect(rows[0].summary).toBe("rain Today");
  });

  it("puts the later stay first once the earlier one is over, and shows no past stay", () => {
    const rows = cityWeather(STOPS, weather, "C", "2027-03-18", true);
    expect(rows.map((r) => [r.city, r.here, r.tiles.length])).toEqual([["Porto", true, 2]]);
  });

  it("changes nothing before the trip: no 'You're here', every day kept (the old behaviour)", () => {
    const rows = cityWeather(STOPS, weather, "C", "2027-03-10");
    expect(rows.map((r) => [r.city, r.here, r.tiles.length])).toEqual([
      ["Lisbon", false, 3],
      ["Porto", false, 3],
    ]);
    // `during` is what turns the rule on: the same date without it keeps past days.
    expect(cityWeather(STOPS, weather, "C", "2027-03-18")).toHaveLength(2);
  });

  it("counts only suggestions for the days ahead (a past rainy day is not an alert)", () => {
    const base = trip({ items: [] });
    const all = pendingByStop(base, { stops: weather, suppressed: {} }, 0);
    const ahead = pendingByStop(
      base,
      { stops: remainingWeather(STOPS, weather, "2027-03-17"), suppressed: {} },
      0,
    );
    const sum = (counts: Record<number, number>) =>
      Object.values(counts).reduce((a, b) => a + b, 0);
    // Lisbon's rainy days are all behind the person on the 17th: those suggestions are not asked about any more.
    expect(sum(all)).toBeGreaterThan(sum(ahead));
  });
});

describe("homeModel while the trip is on", () => {
  it("says ON NOW, shows the day badge instead of the countdown, and opens the list", () => {
    const model = homeModel(trip(), { phase: "none" }, "2027-03-16");
    expect(model.phase).toBe("during");
    expect(model.chip).toBe("ON NOW");
    expect(model.dayBadge?.text).toBe("Day 3 of 11");
    expect(model.countdown).toBeNull();
    expect(model.label).toBe("Open list");
  });

  it("says NEXT TRIP with a countdown and no day badge before it starts, and on the start day", () => {
    for (const today of ["2027-03-01", "2027-03-14"]) {
      const model = homeModel(trip(), { phase: "none" }, today);
      expect(model.chip).toBe("NEXT TRIP");
      expect(model.dayBadge).toBeNull();
      expect(model.countdown).not.toBeNull();
    }
  });

  it("keeps the Last day badge on the end date and goes back to NEXT TRIP-free once past", () => {
    expect(homeModel(trip(), { phase: "none" }, "2027-03-24").dayBadge?.text).toBe("Last day");
    expect(homeModel(trip(), { phase: "none" }, "2027-03-25").dayBadge).toBeNull();
  });
});

describe("one calculation for the review (#410, QA round 2)", () => {
  const day = (date: string, stopIndex: number, rain = 0.1) => ({
    date,
    stopIndex,
    source: "forecast" as const,
    highC: 20,
    lowC: 10,
    precipProbability: rain,
    precipMm: 0,
    snowCm: 0,
    uvIndexMax: 3,
    sunshineHours: 5,
  });
  const weather: StopWeather[] = [
    { stopIndex: 0, status: "ok", days: ["2027-03-15", "2027-03-16"].map((d) => day(d, 0, 0.9)) },
    { stopIndex: 1, status: "ok", days: ["2027-03-17", "2027-03-18"].map((d) => day(d, 1)) },
  ];

  it("weatherForReview keeps the days ahead while the trip is on, and everything before and after it", () => {
    const during = weatherForReview(trip(), STOPS, weather, "2027-03-18");
    expect(during.map((s) => [s.stopIndex, s.days.map((d) => d.date)])).toEqual([
      [1, ["2027-03-18"]],
    ]);
    expect(weatherForReview(trip(), STOPS, weather, "2027-03-10")).toEqual(weather);
    expect(weatherForReview(trip(), STOPS, weather, "2027-03-30")).toEqual(weather);
  });

  it("sends a change that names no stop to a stay on screen, never to one already left", () => {
    const today = "2027-03-18";
    const ahead = weatherForReview(trip(), STOPS, weather, today);
    const rows = cityWeather(STOPS, weather, "C", today, true);
    const model = homeModel(
      trip({ items: [] }),
      { phase: "ready", city: rows, review: { stops: ahead, suppressed: {} } },
      today,
    );
    expect(rows.map((r) => r.stopIndex)).toEqual([1]);
    expect(Object.keys(model.pending).map(Number).sort()).toEqual([1]);
    expect(model.pendingCities).toEqual(["Porto"]);
  });

  it("keeps the current stay first and marked when it has no weather, with the unavailable line", () => {
    const onlyPorto = weather.filter((s) => s.stopIndex === 1);
    const rows = cityWeather(STOPS, onlyPorto, "C", "2027-03-15", true);
    expect(rows.map((r) => [r.city, r.here, r.unavailable ?? false, r.tiles.length])).toEqual([
      ["Lisbon", true, true, 0],
      ["Porto", false, false, 2],
    ]);
    expect(rows[0].summary).toBe("Weather isn't available for Lisbon right now.");
    // Not during the trip: a stay without weather is still simply left out.
    expect(cityWeather(STOPS, onlyPorto, "C", "2027-03-10").map((r) => r.city)).toEqual(["Porto"]);
  });

  it("says N/A, not Clear, on the Weather pill when the only row is the unavailable current stay", () => {
    const rows = cityWeather(STOPS, [], "C", "2027-03-15", true);
    const model = { pendingCities: [], phase: "during" as const, rows };
    expect(rows).toHaveLength(1);
    expect(weatherPillSub({ phase: "ready" }, model).text).toBe("N/A");
  });
});

describe("a one-day trip on its day (#410, QA round 2)", () => {
  it("is Today, not Leaves today; a longer trip still Leaves today", () => {
    const day = { start: "2027-03-14", end: "2027-03-14" };
    expect(countdownFor(day, "2027-03-14")).toMatchObject({
      days: 0,
      dayTrip: true,
      spoken: "Today",
    });
    expect(countdownFor(trip(), "2027-03-14")).toMatchObject({
      dayTrip: false,
      spoken: "Leaves today",
    });
    expect(countdownFor(day, "2027-03-12")?.dayTrip).toBe(false);
  });
});

describe("fallbackReviewStop (#410, round 3)", () => {
  const withDays = (stopIndex: number, dates: string[]): StopWeather => ({
    stopIndex,
    status: "ok",
    days: dates.map((date) => ({
      date,
      stopIndex,
      source: "forecast" as const,
      highC: 20,
      lowC: 10,
      precipProbability: 0.1,
      precipMm: 0,
      snowCm: 0,
      uvIndexMax: 3,
      sunshineHours: 5,
    })),
  });
  const all = [withDays(0, ["2027-03-15"]), withDays(1, ["2027-03-18"])];

  it("is the first stay with days: the stay still ahead during the trip, the first stay otherwise", () => {
    expect(fallbackReviewStop(weatherForReview(trip(), STOPS, all, "2027-03-18"))).toBe(1);
    expect(fallbackReviewStop(weatherForReview(trip(), STOPS, all, "2027-03-10"))).toBe(0);
    expect(fallbackReviewStop([])).toBe(0);
  });
});
