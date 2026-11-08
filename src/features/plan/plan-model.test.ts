import { describe, expect, it } from "vitest";
import { SYNTHETIC_STAPLES } from "@/domain/calc";
import { packedTotals } from "@/domain/readiness";
import type { Staple } from "@/domain/trip";
import { LOCATIONS } from "@/domain/locations";
import {
  draftStops,
  setDraftStops,
  startDraft,
  type DraftStop,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import type { StopWeather } from "@/domain/weather/types";
import { DEFAULT_TRIP_CONFIG } from "@/features/trips/draft";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import {
  aboutItems,
  formatPlanRange,
  howBlocker,
  howSummary,
  laundryEffect,
  laundryLine,
  moveStopTo,
  nightsOf,
  placesOf,
  planWeatherRows,
  previewTrip,
  sortedLine,
  stepBlocker,
  stopRange,
  summarizeItems,
  tagTitle,
  tripLength,
  weatherAdds,
  whenBlocker,
  whenSummary,
  whereBlocker,
  whereSummary,
  withChoices,
} from "./plan-model";

const place = (id: string) => LOCATIONS.find((entry) => entry.id === id)!;
const LONDON = place("gb-eng-london");
const LISBON = place("pt-lisbon");
const PARIS = place("fr-idf-paris");

const TEES: Staple = {
  id: "tops",
  name: "Tees",
  qty: 1,
  cadence: "per day",
  category: "Clothing",
  packLast: false,
  laundryHalves: true,
};
const STAPLES: Staple[] = [...SYNTHETIC_STAPLES, TEES];

function draftFor(start: string, end: string, laundry = false): TripDraft {
  const base = startDraft({ ...DEFAULT_TRIP_CONFIG, laundry }, start, end);
  return setDraftStops(base, [{ location: LONDON, arrive: start, leave: end }]);
}

const stop = (location: DraftStop["location"], arrive: string, leave: string): DraftStop => ({
  location,
  arrive,
  leave,
});

function route(...stops: DraftStop[]): TripDraft {
  return setDraftStops(startDraft(DEFAULT_TRIP_CONFIG, "", ""), stops);
}

describe("blockers", () => {
  it("Where needs a confirmed place for every stop, in words that fit one stop or many", () => {
    expect(whereBlocker(startDraft(DEFAULT_TRIP_CONFIG, "", ""))).toBe(
      "Choose a destination from the list to continue.",
    );
    expect(whereBlocker(route(stop(LONDON, "", ""), stop(null, "", "")))).toBe(
      "Choose a place for each stop to continue.",
    );
    expect(whereBlocker(draftFor("2026-11-12", "2026-11-16"))).toBeNull();
  });

  it("When needs real dates (one stop) or a contiguous route (several), and a moved start for a stale copy", () => {
    expect(whenBlocker(draftFor("", ""))).toBe(
      "Choose your departure and return dates to continue.",
    );
    expect(whenBlocker(draftFor("2026-11-12", ""))).toBe(
      "Choose your departure and return dates to continue.",
    );
    expect(whenBlocker(draftFor("2026-11-12", "2026-11-16"))).toBeNull();
    expect(whenBlocker(draftFor("2026-11-12", "2026-11-16"), true)).toBe(
      "Choose a new start date for the copy.",
    );
    const gap = route(
      stop(LONDON, "2026-11-12", "2026-11-14"),
      stop(LISBON, "2026-11-15", "2026-11-17"),
    );
    expect(whenBlocker(gap)).toBe("Fix 1 thing above to continue.");
    const fine = route(
      stop(LONDON, "2026-11-12", "2026-11-14"),
      stop(LISBON, "2026-11-14", "2026-11-17"),
    );
    expect(whenBlocker(fine)).toBeNull();
    // A missing place is Where's problem, not When's.
    expect(
      whenBlocker(
        route(stop(null, "2026-11-12", "2026-11-14"), stop(LISBON, "2026-11-14", "2026-11-17")),
      ),
    ).toBeNull();
  });

  it("How needs a choice; the Starting list and Review never block", () => {
    const draft = draftFor("2026-11-12", "2026-11-16");
    expect(howBlocker(draft)).toBe("Choose how you’re getting there to continue.");
    expect(howBlocker({ ...draft, travelMode: "drive" })).toBeNull();
    expect(stepBlocker(draft, "list")).toBeNull();
    expect(stepBlocker(draft, "review")).toBeNull();
    expect(stepBlocker(draft, "how")).not.toBeNull();
  });
});

describe("summaries", () => {
  it("formats a range inside one month and across two", () => {
    expect(formatPlanRange("2026-03-14", "2026-03-24")).toBe("Sat 14 – Tue 24 Mar");
    expect(formatPlanRange("2026-03-28", "2026-04-07")).toBe("Sat 28 Mar – Tue 7 Apr");
    expect(formatPlanRange("", "2026-03-24")).toBe("");
    // A day trip says its one date, and the When summary says "day trip" (#412).
    expect(formatPlanRange("2026-03-14", "2026-03-14")).toBe("Sat 14 Mar");
    expect(formatPlanRange("2026-03-14", "nope")).toBe("");
  });

  it("formats a stop's dates for its row", () => {
    expect(stopRange({ arrive: "2026-03-15", leave: "2026-03-18" })).toBe("15–18 Mar");
    expect(stopRange({ arrive: "2026-03-30", leave: "2026-04-02" })).toBe("30 Mar – 2 Apr");
    expect(stopRange({ arrive: "", leave: "2026-03-18" })).toBe("");
    // A day trip has one date (#412).
    expect(stopRange({ arrive: "2026-03-15", leave: "2026-03-15" })).toBe("15 Mar");
  });

  it("summarizes where, when and how in the words of the design", () => {
    const draft = {
      ...route(stop(LISBON, "2026-03-14", "2026-03-18"), stop(PARIS, "2026-03-18", "2026-03-24")),
      travelMode: "fly" as const,
    };
    expect(whereSummary(draft)).toBe("Lisbon + Paris");
    expect(whenSummary(draft)).toBe("Sat 14 – Tue 24 Mar · 10 nights");
    expect(howSummary(draft)).toBe("Flying");
    expect(howSummary({ ...draft, travelMode: "drive" })).toBe("Driving");
    expect(howSummary({ ...draft, travelMode: "other" })).toBe("Train or other");
    expect(howSummary({ ...draft, travelMode: null })).toBe("");
    expect(nightsOf(draft)).toBe(10);
    expect(tripLength(draft)).toBe(11);
    expect(placesOf(draft).map((entry) => entry.city)).toEqual(["Lisbon", "Paris"]);
  });

  it("a one-night and a day trip read '1 night' and 'Sat 14 Mar · day trip' (#412)", () => {
    expect(whenSummary(draftFor("2026-03-14", "2026-03-15"))).toBe("Sat 14 – Sun 15 Mar · 1 night");
    expect(whenSummary(draftFor("2026-03-14", "2026-03-14"))).toBe("Sat 14 Mar · day trip");
  });

  it("has no summary and no length until the dates are real", () => {
    const draft = draftFor("", "");
    expect(whenSummary(draft)).toBe("");
    expect(nightsOf(draft)).toBeNull();
    expect(tripLength(draft)).toBe(0);
  });

  it("names the tag by the first place, then '& the rest', or by the owner's name", () => {
    const two = route(
      stop(LISBON, "2026-03-14", "2026-03-18"),
      stop(PARIS, "2026-03-18", "2026-03-24"),
    );
    expect(tagTitle(two)).toEqual({ title: "Lisbon", also: "& Paris" });
    expect(tagTitle({ ...two, name: "  Spring break " })).toEqual({
      title: "Spring break",
      also: "",
    });
    expect(tagTitle(draftFor("", ""))).toEqual({ title: "London", also: "" });
    expect(tagTitle(startDraft(DEFAULT_TRIP_CONFIG, "", ""))).toEqual({ title: "", also: "" });
  });
});

describe("the preview is the trip that gets created", () => {
  const today = "2026-11-01";

  it("is null until Where and When are finished", () => {
    expect(previewTrip({ draft: draftFor("", ""), staples: STAPLES, today })).toBeNull();
    expect(
      previewTrip({
        draft: startDraft(DEFAULT_TRIP_CONFIG, "2026-11-12", "2026-11-16"),
        staples: STAPLES,
        today,
      }),
    ).toBeNull();
  });

  // The same count the created trip has, at several lengths, laundry off and on: the memory source creates the trip through
  // the same `saveDraft` the server uses.
  const total = (trip: Parameters<typeof packedTotals>[0]) => packedTotals(trip).total;
  it.each([
    ["a day trip", "2026-11-12", "2026-11-12"],
    ["a weekend", "2026-11-12", "2026-11-14"],
    ["a week", "2026-11-12", "2026-11-18"],
    ["ten nights", "2026-11-12", "2026-11-22"],
    ["three weeks", "2026-11-12", "2026-12-03"],
  ])("matches createTrip for %s, with laundry off and on", async (_name, start, end) => {
    for (const laundry of [false, true]) {
      const draft = draftFor(start, end, laundry);
      const source = createMemoryTripsSource(sampleLifecycleState(), {
        now: () => 1,
        staples: STAPLES,
        today: () => today,
      });
      const created = await source.createTrip(draft);
      const preview = previewTrip({ draft, staples: STAPLES, today });
      expect(preview?.total).toBe(total(created));
      expect(preview?.items.map((item) => [item.id, item.qty])).toEqual(
        created.items.map((item) => [item.id, item.qty]),
      );
    }
  });

  it("laundry makes the trip smaller", () => {
    const off = previewTrip({
      draft: draftFor("2026-11-12", "2026-11-22"),
      staples: STAPLES,
      today,
    });
    const on = previewTrip({
      draft: draftFor("2026-11-12", "2026-11-22", true),
      staples: STAPLES,
      today,
    });
    expect(on!.total).toBeLessThan(off!.total);
  });

  it("a saved list replaces the Staples", () => {
    const list = {
      id: "list-1",
      name: "Beach",
      updatedAt: "2026-10-01T00:00:00.000Z",
      items: [
        { id: "a", name: "Towel", category: "Misc", qty: 2 },
        { id: "b", name: "Hat", category: "Clothing", qty: 1 },
      ],
    };
    const preview = previewTrip({
      draft: { ...draftFor("2026-11-12", "2026-11-16"), savedListId: "list-1" },
      staples: STAPLES,
      list,
      today,
    });
    expect(preview?.total).toBe(3);
  });

  it("ignores a saved-list id when no list is given (the Staples build the trip)", () => {
    const withId = previewTrip({
      draft: { ...draftFor("2026-11-12", "2026-11-16"), savedListId: "gone" },
      staples: STAPLES,
      today,
    });
    const without = previewTrip({
      draft: draftFor("2026-11-12", "2026-11-16"),
      staples: STAPLES,
      today,
    });
    expect(withId?.total).toBe(without?.total);
  });

  it("groups into the cubes that have something, in cube order, by quantity", () => {
    const summary = summarizeItems([
      { id: "tops", name: "Tops", category: "Clothing", qty: 3, packed: 0, section: "main" },
      {
        id: "weather-thing",
        name: "Thing",
        category: "Weather",
        qty: 1,
        packed: 0,
        section: "main",
        cube: "weather",
      },
      { id: "x", name: "Charger", category: "Tech", qty: 2, packed: 0, section: "main" },
    ]);
    expect(summary.total).toBe(6);
    expect(summary.cubes.map((cube) => [cube.label, cube.count])).toEqual([
      ["Clothing", 3],
      ["Tech", 2],
      ["Weather gear", 1],
    ]);
  });

  it("names the weather cube for what is in it", () => {
    const summary = summarizeItems([
      {
        id: "weather-umbrella",
        name: "Umbrella",
        category: "Weather",
        qty: 1,
        packed: 0,
        section: "main",
        cube: "weather",
      },
    ]);
    expect(summary.cubes[0].label).toBe("Rain gear");
  });

  it("says the words: About N items to start, and sorted into N cubes", () => {
    expect(aboutItems(60)).toBe("About 60 items to start");
    expect(aboutItems(1)).toBe("About 1 item to start");
    const preview = previewTrip({
      draft: draftFor("2026-11-12", "2026-11-16"),
      staples: STAPLES,
      today,
    })!;
    const line = sortedLine(preview);
    expect(line.bold).toBe(`About ${preview.total} items`);
    expect(line.rest).toBe(
      ` sorted into ${preview.cubes.length} cubes. You can edit everything after.`,
    );
    expect(
      sortedLine({ items: [], total: 1, cubes: [{ cube: "misc", label: "Misc", count: 1 }] }),
    ).toEqual({
      bold: "About 1 item",
      rest: " sorted into 1 cube. You can edit everything after.",
    });
  });
});

describe("laundry", () => {
  const today = "2026-11-01";
  const draft = draftFor("2026-11-12", "2026-11-22");

  it("finds the Staple that gets smallest, as the real build computes it", () => {
    const effect = laundryEffect(draft, STAPLES, today);
    expect(effect).toEqual({ name: "Tees", off: 10, on: 5 });
    expect(laundryLine(effect, true)).toBe(
      "Tees: 5 instead of 10. Underwear and socks stay one per day.",
    );
    expect(laundryLine(effect, false)).toBe(
      "Tees would be 5 instead of 10. Underwear and socks stay one per day.",
    );
  });

  it("picks the biggest saving when several Staples are marked", () => {
    const bottoms: Staple = { ...TEES, id: "bottoms", name: "Pants", qty: 2 };
    expect(laundryEffect(draft, [...STAPLES, bottoms], today)?.name).toBe("Pants");
  });

  it("with nothing marked, the calculator's own everyday rows still get smaller", () => {
    expect(laundryEffect(draft, SYNTHETIC_STAPLES, today)).toEqual({
      name: "Everyday tops",
      off: 10,
      on: 5,
    });
  });

  it("says so when laundry changes nothing (a day trip)", () => {
    const effect = laundryEffect(draftFor("2026-11-12", "2026-11-12"), SYNTHETIC_STAPLES, today);
    expect(effect).toBeNull();
    expect(laundryLine(effect, true)).toBe(
      "Nothing on your Staples is marked ↻, so laundry changes nothing yet.",
    );
  });

  it("is judged on the chosen saved list: a fixed list of Towels has no laundry effect, however long the trip (#412)", () => {
    const list = {
      id: "l1",
      name: "Fixed",
      items: [{ id: "towel", name: "Towels", category: "Accessories", qty: 2 }],
    } as unknown as Parameters<typeof laundryEffect>[3];
    const long = withChoices(draftFor("2026-11-12", "2026-11-22"), {
      copy: null,
      listId: "l1",
      laundry: false,
    });
    expect(laundryEffect(long, SYNTHETIC_STAPLES, today, list)).toBeNull();
    // The same trip from the Staples does have one.
    expect(laundryEffect(long, SYNTHETIC_STAPLES, today)).not.toBeNull();
  });

  it("is judged on a copied trip's preferences: one night with the return outfit off still halves tops (#412)", () => {
    const night = draftFor("2026-11-12", "2026-11-13");
    const plain = withChoices(night, { copy: null, listId: null, laundry: false });
    expect(laundryEffect(plain, SYNTHETIC_STAPLES, today)).toBeNull();
    const source = sampleLifecycleState().trips[0];
    const copied = withChoices(night, {
      copy: { ...source, config: { ...source.config, returnOutfit: false } },
      listId: null,
      laundry: false,
    });
    expect(laundryEffect(copied, SYNTHETIC_STAPLES, today)?.name).toBe("Everyday tops");
  });

  it("has no effect while the trip is not complete", () => {
    expect(laundryEffect(draftFor("", ""), STAPLES, today)).toBeNull();
  });
});

describe("the draft that is created", () => {
  const draft = {
    ...draftFor("2026-11-12", "2026-11-16"),
    name: "  Spring  ",
    travelMode: "fly" as const,
  };
  const source = sampleLifecycleState().trips[0];

  it("is a new trip with the defaults and the chosen laundry", () => {
    const made = withChoices(draft, { copy: null, listId: null, laundry: true });
    expect(made).toMatchObject({
      mode: "create",
      sourceId: null,
      name: "Spring",
      travelMode: "fly",
    });
    expect(made.config).toEqual({ ...DEFAULT_TRIP_CONFIG, laundry: true });
    expect(made.savedListId).toBeUndefined();
  });

  it("starts from a saved list when one is chosen", () => {
    expect(withChoices(draft, { copy: null, listId: "list-1", laundry: false }).savedListId).toBe(
      "list-1",
    );
  });

  it("copies a past trip's preferences with this trip's own laundry, and never also uses a list", () => {
    const made = withChoices(draft, { copy: source, listId: "list-1", laundry: true });
    expect(made).toMatchObject({ mode: "copy", sourceId: source.id });
    expect(made.config).toEqual({ ...source.config, laundry: true });
    expect(made.savedListId).toBeUndefined();
  });

  it("sends no name for a blank one", () => {
    expect(
      withChoices({ ...draft, name: "   " }, { copy: null, listId: null, laundry: false }).name,
    ).toBeNull();
    expect(
      withChoices({ ...draft, name: null }, { copy: null, listId: null, laundry: false }).name,
    ).toBeNull();
  });
});

describe("moving a stop", () => {
  const stops = [
    stop(LONDON, "2026-11-10", "2026-11-12"),
    stop(LISBON, "2026-11-12", "2026-11-15"),
    stop(PARIS, "2026-11-15", "2026-11-16"),
  ];

  it("moves forward and back, keeping each stop's nights and the route contiguous", () => {
    const forward = moveStopTo(stops, 0, 2);
    expect(forward.map((entry) => entry.location?.city)).toEqual(["Lisbon", "Paris", "London"]);
    expect(forward.map((entry) => [entry.arrive, entry.leave])).toEqual([
      ["2026-11-10", "2026-11-13"],
      ["2026-11-13", "2026-11-14"],
      ["2026-11-14", "2026-11-16"],
    ]);
    const back = moveStopTo(stops, 2, 0);
    expect(back.map((entry) => entry.location?.city)).toEqual(["Paris", "London", "Lisbon"]);
  });

  it("leaves the route alone for the same place or a place that is not there", () => {
    expect(moveStopTo(stops, 1, 1)).toEqual(stops);
    expect(moveStopTo(stops, -1, 1)).toEqual(stops);
    expect(moveStopTo(stops, 0, 3)).toEqual(stops);
  });

  it("round-trips through the draft's route", () => {
    const draft = route(...stops);
    expect(
      draftStops(setDraftStops(draft, moveStopTo(draftStops(draft), 0, 1)))[0].location?.city,
    ).toBe("Lisbon");
  });
});

describe("weather", () => {
  const today = "2026-11-10";
  const day = (date: string, rain: number, high = 18, low = 11) => ({
    date,
    stopIndex: 0,
    source: "forecast" as const,
    highC: high,
    lowC: low,
    precipProbability: rain,
    precipMm: rain * 10,
    snowCm: 0,
    uvIndexMax: 3,
    sunshineHours: 5,
  });
  const wet: StopWeather[] = [
    {
      stopIndex: 0,
      status: "ok",
      days: [
        day("2026-11-12", 0.9),
        day("2026-11-13", 0.9),
        day("2026-11-14", 0.9),
        day("2026-11-15", 0.1),
      ],
    },
  ];
  const draft = draftFor("2026-11-12", "2026-11-15");

  it("adds what the recommendation calls for and says what it added", () => {
    const adds = weatherAdds(draft, wet, STAPLES, today);
    expect(adds.accepted.length).toBeGreaterThan(0);
    expect(adds.added).toBeGreaterThan(0);
    expect(adds.line).toMatch(/ · \d+ added$/);
    expect(adds.accepted.every((change) => change.ruleSignature)).toBe(true);
  });

  it("the count it adds is the difference the created trip has", () => {
    const adds = weatherAdds(draft, wet, STAPLES, today);
    const without = previewTrip({ draft, staples: STAPLES, today })!;
    const withIt = previewTrip({ draft, staples: STAPLES, accepted: adds.accepted, today })!;
    expect(withIt.total - without.total).toBe(adds.added);
  });

  it("says nothing is needed for dry weather", () => {
    const dry: StopWeather[] = [
      {
        stopIndex: 0,
        status: "ok",
        days: [day("2026-11-12", 0), day("2026-11-13", 0)].map((d) => ({
          ...d,
          highC: 21,
          lowC: 14,
        })),
      },
    ];
    const adds = weatherAdds(draft, dry, STAPLES, today);
    if (adds.accepted.length === 0) expect(adds.line).toBe("Nothing needed for this weather");
    else expect(adds.line).toMatch(/added$/);
  });

  it("draws a row per stop: rain days by weekday, or dry", () => {
    const route1 = [{ location: LONDON, arrive: "2026-11-12", leave: "2026-11-15" }];
    const [row] = planWeatherRows(route1, wet, "F", today);
    expect(row).toMatchObject({ city: "London", alert: true, glyph: "rain", dates: "12–15 Nov" });
    expect(row.line).toBe("rain Thu–Sat");
    expect(row.range).toBe("64° / 52°");
    expect(row.forecast).toBe(true);
    const dryStop: StopWeather[] = [{ stopIndex: 0, status: "ok", days: [day("2026-11-12", 0)] }];
    const [dry] = planWeatherRows(route1, dryStop, "C", today);
    expect(dry).toMatchObject({ alert: false, line: "mostly dry", range: "18° / 11°" });
  });

  it("says rain on one day by its weekday only, and snow as snow", () => {
    const route1 = [{ location: LONDON, arrive: "2026-11-12", leave: "2026-11-15" }];
    const oneWet: StopWeather[] = [
      { stopIndex: 0, status: "ok", days: [day("2026-11-12", 0.9), day("2026-11-13", 0)] },
    ];
    expect(planWeatherRows(route1, oneWet, "C", today)[0].line).toBe("rain Thu");
    const snow: StopWeather[] = [
      { stopIndex: 0, status: "ok", days: [{ ...day("2026-11-12", 0.9), snowCm: 5 }] },
    ];
    const [row] = planWeatherRows(route1, snow, "C", today);
    expect(row.glyph).toBe("snow");
    expect(row.line).toBe("snow Thu");
  });

  it("falls back to the rain count for typical days, and skips stops without weather", () => {
    const route2 = [
      { location: LONDON, arrive: "2026-12-12", leave: "2026-12-15" },
      { location: LISBON, arrive: "2026-12-15", leave: "2026-12-18" },
    ];
    const typical: StopWeather[] = [
      {
        stopIndex: 0,
        status: "ok",
        days: [
          { ...day("2026-12-12", 0.9), source: "typical" },
          { ...day("2026-12-13", 0.1), source: "typical" },
        ],
      },
      { stopIndex: 1, status: "unavailable", days: [] },
      { stopIndex: 5, status: "ok", days: [day("2026-12-16", 0)] },
    ];
    const rows = planWeatherRows(route2, typical, "C", today);
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe("Rain on 1 of 2 days");
    expect(rows[0].forecast).toBe(false);
  });
});
