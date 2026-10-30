import { describe, expect, it } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { formatDays, formatRange, quickViewModel, tripCardView } from "./view";

const TODAY = "2026-10-16";
const trips = () => sampleLifecycleState().trips;
const sanDiego = () => trips().find((trip) => trip.id === "san-diego")!;
const lisbon = () => trips().find((trip) => trip.id === "lisbon")!;
const withPatch = (trip: LifecycleTrip, patch: Partial<LifecycleTrip>): LifecycleTrip => ({
  ...trip,
  ...patch,
});

describe("formatDays", () => {
  it("pluralizes", () => {
    expect(formatDays(1)).toBe("1\u00a0day");
    expect(formatDays(0)).toBe("0\u00a0days");
    expect(formatDays(5)).toBe("5\u00a0days");
  });
});

describe("formatRange", () => {
  it("formats an inclusive range as short month and day, timezone-safe", () => {
    expect(formatRange({ start: "2026-10-23", end: "2026-10-27" })).toBe("Oct 23 – Oct 27");
    expect(formatRange({ start: "2026-12-30", end: "2027-01-02" })).toBe("Dec 30 – Jan 2");
  });

  it("falls back for missing or malformed dates", () => {
    expect(formatRange({ start: "", end: "2026-10-27" })).toBe("Choose dates – Oct 27");
    expect(formatRange({ start: "2026-10-23", end: "nope" })).toBe("Oct 23 – Choose dates");
  });
});

describe("tripCardView", () => {
  it("describes an upcoming, partly packed trip with no eyebrow and no weather copy", () => {
    const view = tripCardView(sanDiego(), TODAY, "upcoming");
    expect(view).toMatchObject({
      id: "san-diego",
      destination: "San Diego",
      place: "California, United States",
      eyebrow: null,
      ready: false,
      packed: 6,
      total: 32,
      remaining: 26,
      percent: 19,
      range: "Oct 23 – Oct 27",
      days: 5,
      canArchive: true,
      canRestore: false,
    });
  });

  it("describes a past, packed and Ready trip", () => {
    const view = tripCardView(lisbon(), TODAY, "archive");
    expect(view).toMatchObject({
      eyebrow: "Past trip",
      ready: true,
      remaining: 0,
      percent: 100,
      canArchive: false,
      canRestore: false,
    });
    expect(view.packed).toBe(view.total);
  });

  it("offers Restore only for an archived trip that is still in the future", () => {
    const future = withPatch(sanDiego(), { archived: true });
    expect(tripCardView(future, TODAY, "archive")).toMatchObject({
      eyebrow: "Archived trip",
      canRestore: true,
      canArchive: false,
    });
    const pastArchived = withPatch(lisbon(), { archived: true });
    expect(tripCardView(pastArchived, TODAY, "archive")).toMatchObject({
      eyebrow: "Archived trip",
      canRestore: false,
    });
  });

  it("keeps a trip upcoming through its end date and past the day after", () => {
    const endsToday = withPatch(sanDiego(), { end: TODAY });
    expect(tripCardView(endsToday, TODAY, "upcoming").eyebrow).toBeNull();
    expect(tripCardView(endsToday, "2026-10-17", "archive").eyebrow).toBe("Past trip");
  });

  it("carries no weather copy: the dashboard fetches no weather, so the card says nothing about the forecast", () => {
    expect(tripCardView(sanDiego(), TODAY, "upcoming")).not.toHaveProperty("forecast");
    expect(tripCardView(lisbon(), TODAY, "archive")).not.toHaveProperty("forecast");
  });

  it("has no place without a confirmed location", () => {
    const view = tripCardView(withPatch(sanDiego(), { location: null }), TODAY, "upcoming");
    expect(view.place).toBeNull();
  });

  it("shows only the parts of the place that exist (no dangling comma for an empty country or region)", () => {
    const location = sanDiego().location!;
    const place = (patch: object) =>
      tripCardView(
        withPatch(sanDiego(), { location: { ...location, ...patch } }),
        TODAY,
        "upcoming",
      ).place;
    expect(place({ country: "" })).toBe("California");
    expect(place({ region: "" })).toBe("United States");
    expect(place({ region: "", country: "" })).toBeNull();
  });

  it("rounds the percentage to the nearest whole number (2 of 3 is 67%, 1 of 3 is 33%)", () => {
    const base = sanDiego();
    const item = { ...base.items[0], qty: 3 };
    const twoOfThree = withPatch(base, {
      items: [{ ...item, packed: 2 }],
      toiletryBagPacked: false,
    });
    expect(tripCardView(twoOfThree, TODAY, "upcoming")).toMatchObject({
      packed: 2,
      total: 3,
      percent: 67,
    });
    const oneOfThree = withPatch(base, {
      items: [{ ...item, packed: 1 }],
      toiletryBagPacked: false,
    });
    expect(tripCardView(oneOfThree, TODAY, "upcoming")).toMatchObject({
      packed: 1,
      total: 3,
      percent: 33,
    });
    const sixOfNine = withPatch(base, {
      items: [{ ...item, qty: 8, packed: 5 }],
      toiletryBagPacked: false,
    });
    expect(tripCardView(sixOfNine, TODAY, "upcoming").percent).toBe(63);
  });

  it("reports 0% for a trip with no items instead of dividing by zero", () => {
    const empty = withPatch(sanDiego(), { items: [], toiletryBagPacked: false });
    expect(tripCardView(empty, TODAY, "upcoming")).toMatchObject({
      total: 0,
      packed: 0,
      percent: 0,
      remaining: 0,
    });
  });
});

describe("quickViewModel", () => {
  it("'still to pack' lists only unfinished rows, grouped, with remaining counts", () => {
    const model = quickViewModel(sanDiego(), "still");
    expect(model.categories.map((entry) => entry.title)).toEqual([
      "Clothing & essentials",
      "Toiletries",
      "Return outfit",
      "Pack last",
    ]);
    const clothing = model.categories[0].rows;
    expect(clothing.find((row) => row.name === "Underwear")?.detail).toBe("3 left");
    expect(clothing.find((row) => row.name === "Everyday tops")?.detail).toBe("2 left");
    expect(clothing.some((row) => row.name === "Sleepwear")).toBe(false);
  });

  it("'all' also lists packed rows as Packed", () => {
    const model = quickViewModel(sanDiego(), "all");
    const clothing = model.categories[0].rows;
    expect(clothing.find((row) => row.name === "Sleepwear")?.detail).toBe("Packed");
    expect(model.categories.flatMap((entry) => entry.rows).length).toBeGreaterThan(
      quickViewModel(sanDiego(), "still").categories.flatMap((entry) => entry.rows).length,
    );
  });

  it("marks Pack last items and keeps toiletries in their own group", () => {
    const model = quickViewModel(sanDiego(), "all");
    const packLast = model.categories.find((entry) => entry.title === "Pack last")!;
    expect(packLast.rows.every((row) => row.packLast)).toBe(true);
    expect(packLast.rows.map((row) => row.name)).not.toContain("Toothbrush");
    const toiletries = model.categories.find((entry) => entry.title === "Toiletries")!;
    expect(toiletries.rows.map((row) => row.name)).toEqual([
      "Toothbrush",
      "Toothpaste",
      "Deodorant",
      "Contacts",
    ]);
  });

  it("is empty for a fully packed trip under 'still to pack'", () => {
    expect(quickViewModel(lisbon(), "still").categories).toEqual([]);
  });

  it("shows the toiletry bag gate in all three states", () => {
    const waiting = sanDiego();
    expect(quickViewModel(waiting, "still").bag).toEqual({
      status: "waiting",
      label: "Waiting on contents",
    });
    const contentsDone = withPatch(waiting, {
      items: waiting.items.map((item) =>
        item.groupId === "toiletry-bag" ? { ...item, packed: item.qty } : item,
      ),
    });
    expect(quickViewModel(contentsDone, "still").bag).toEqual({
      status: "pending",
      label: "Still outside suitcase",
    });
    expect(
      quickViewModel(withPatch(contentsDone, { toiletryBagPacked: true }), "still").bag,
    ).toEqual({ status: "complete", label: "In suitcase" });
  });

  it("does not modify the trip it reads", () => {
    const trip = sanDiego();
    const before = structuredClone(trip);
    quickViewModel(trip, "still");
    quickViewModel(trip, "all");
    expect(trip).toEqual(before);
  });
});

describe("route display (epic #107)", () => {
  it("lists a multi-stop trip's cities, and nothing for a single destination", async () => {
    const { routeCities } = await import("./view");
    const stop = (city: string) => ({
      location: { id: city, city, region: "", country: "", countryCode: "", label: city },
      arrive: "2030-05-01",
      leave: "2030-05-02",
    });
    expect(routeCities({ stops: [stop("A"), stop("B")] })).toEqual(["A", "B"]);
    expect(routeCities({ stops: [stop("A")] })).toEqual([]);
    expect(routeCities({ stops: [] })).toEqual([]);
  });

  it("shows a route that fits in full, and a long one as first, an ellipsis and last", async () => {
    const { routeDisplay } = await import("./view");
    expect(routeDisplay(["Lisbon", "Porto", "Madrid"])).toMatchObject({
      cities: ["Lisbon", "Porto", "Madrid"],
      shortened: false,
      spoken: "Route: Lisbon, then Porto, then Madrid.",
    });
    const long = routeDisplay(["Lisbon", "Porto", "Madrid", "Barcelona", "Valencia"]);
    expect(long).toMatchObject({ cities: ["Lisbon", "…", "Valencia"], shortened: true, count: 5 });
    expect(routeDisplay(["Lisbon", "Porto", "Madrid", "Barcelona", "Valencia"], 80).shortened).toBe(
      false,
    );
  });

  it("never shortens a two-city route", async () => {
    const { routeDisplay } = await import("./view");
    expect(
      routeDisplay(["A very long city name indeed", "Another very long city name"]).shortened,
    ).toBe(false);
  });
});

describe("Field Ledger dashboard view models (#143)", () => {
  it("counts days to go, nights and the range from today", async () => {
    const { departureView } = await import("./view");
    expect(departureView(sanDiego(), TODAY)).toMatchObject({
      daysToGo: 7,
      daysLabel: "days to go",
      startShort: "Oct 23",
      range: "Oct 23 – Oct 27",
      nights: 4,
      nightsLabel: "4 nights",
    });
    expect(departureView(sanDiego(), "2026-10-22")).toMatchObject({
      daysToGo: 1,
      daysLabel: "day to go",
    });
    expect(departureView(sanDiego(), "2026-10-25")).toMatchObject({
      daysToGo: 0,
      daysLabel: "under way",
    });
    expect(departureView({ start: "2026-10-23", end: "2026-10-24" }, TODAY).nightsLabel).toBe(
      "1 night",
    );
  });

  it("labels the journeys ahead", async () => {
    const { journeysAheadLabel } = await import("./view");
    expect([0, 1, 3].map(journeysAheadLabel)).toEqual([
      "No journeys ahead",
      "1 journey ahead",
      "3 journeys ahead",
    ]);
  });

  it("builds one compact weather cell per stay that has weather, in the person's unit", async () => {
    const { weatherCells } = await import("./view");
    const stop = (city: string, arrive: string, leave: string) => ({
      location: { id: city, city, region: "", country: "", countryCode: "", label: city },
      arrive,
      leave,
    });
    const day = (stopIndex: number, over: Record<string, unknown> = {}) => ({
      date: "2030-05-01",
      stopIndex,
      source: "forecast" as const,
      highC: 20,
      lowC: 10,
      precipProbability: 0,
      precipMm: 0,
      snowCm: 0,
      uvIndexMax: null,
      sunshineHours: null,
      ...over,
    });
    const stops = [
      stop("A", "2030-05-01", "2030-05-03"),
      stop("B", "2030-05-03", "2030-05-05"),
      stop("C", "2030-05-05", "2030-05-06"),
      stop("D", "2030-05-06", "2030-05-07"),
    ];
    const weather = [
      { stopIndex: 0, status: "ok" as const, days: [day(0), day(0)] },
      {
        stopIndex: 1,
        status: "ok" as const,
        days: [
          day(1, { precipProbability: 0.9, source: "typical" }),
          day(1, { source: "typical" }),
        ],
      },
      { stopIndex: 2, status: "unavailable" as const, days: [] },
      { stopIndex: 3, status: "ok" as const, days: [day(3, { snowCm: 5 })] },
    ];
    const cells = weatherCells(stops, weather, "F");
    expect(cells.map((cell) => cell.city)).toEqual(["A", "B", "D"]);
    expect(cells[0]).toMatchObject({
      range: "68° / 50°",
      note: "Mostly dry",
      source: "Forecast",
      glyph: "sun",
    });
    expect(cells[1]).toMatchObject({
      note: "Rain on 1 of 2 days",
      source: "Typical",
      glyph: "rain",
    });
    expect(cells[2]).toMatchObject({ note: "Snow likely", glyph: "snow" });
    expect(weatherCells(stops, weather, "C")[0].range).toBe("20° / 10°");
  });
});

describe("heroForecast (#303)", () => {
  const stop = (city: string, arrive: string, leave: string) => ({
    location: { id: city, city, region: "", country: "", countryCode: "", label: city },
    arrive,
    leave,
  });
  const day = (stopIndex: number, date: string, over: Record<string, unknown> = {}) => ({
    date,
    stopIndex,
    source: "forecast" as const,
    highC: 20,
    lowC: 10,
    precipProbability: 0,
    precipMm: 0,
    snowCm: 0,
    uvIndexMax: null,
    sunshineHours: null,
    ...over,
  });
  const dates = (count: number) =>
    Array.from({ length: count }, (_, at) => `2030-05-${String(at + 1).padStart(2, "0")}`);
  const stops = [stop("A", "2030-05-01", "2030-05-20"), stop("B", "2030-05-20", "2030-05-25")];

  it("is null when no stay has a forecast day (typical-only trips get no block)", async () => {
    const { heroForecast } = await import("./view");
    const typical = [
      {
        stopIndex: 0,
        status: "ok" as const,
        days: [day(0, "2030-05-01", { source: "typical" as const })],
      },
    ];
    expect(heroForecast(stops, typical, "C", "2030-05-01")).toBeNull();
    expect(heroForecast(stops, [], "C", "2030-05-01")).toBeNull();
    expect(
      heroForecast(stops, [{ stopIndex: 0, status: "unavailable" as const, days: [] }], "C"),
    ).toBeNull();
  });

  it("names the first stay that has forecast days, skipping stays without", async () => {
    const { heroForecast } = await import("./view");
    const weather = [
      {
        stopIndex: 0,
        status: "ok" as const,
        days: [day(0, "2030-05-01", { source: "typical" as const })],
      },
      { stopIndex: 1, status: "ok" as const, days: [day(1, "2030-05-21")] },
    ];
    const result = heroForecast(stops, weather, "F", "2030-05-21");
    expect(result).toMatchObject({ stopIndex: 1, city: "B", more: 0 });
    expect(result?.days).toHaveLength(1);
    expect(result?.days[0]).toMatchObject({ label: "Today May 21", high: 68, low: 50 });
  });

  it("caps at 7 days and counts the rest, at exactly 7, 8 and 16 forecast days", async () => {
    const { heroForecast, HERO_FORECAST_CAP } = await import("./view");
    expect(HERO_FORECAST_CAP).toBe(7);
    const forCount = (count: number) =>
      heroForecast(
        stops,
        [{ stopIndex: 0, status: "ok" as const, days: dates(count).map((d) => day(0, d)) }],
        "C",
        "2030-05-01",
      )!;
    expect(forCount(7)).toMatchObject({ more: 0 });
    expect(forCount(7).days).toHaveLength(7);
    expect(forCount(8)).toMatchObject({ more: 1 });
    expect(forCount(8).days).toHaveLength(7);
    expect(forCount(16)).toMatchObject({ more: 9 });
    expect(forCount(16).days.map((d) => d.date)).toEqual(dates(7));
  });
});
