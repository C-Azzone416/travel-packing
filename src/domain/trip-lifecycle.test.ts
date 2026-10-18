import { describe, expect, it } from "vitest";
import { findIdentityViolations } from "./item-ops";
import {
  archiveTrip,
  beginDraft,
  buildTrip,
  cancelDraft,
  classifyTrip,
  emptyLifecycleState,
  isPastTrip,
  pastAndArchivedTrips,
  purgeDeletedTrips,
  removeTrip,
  restoreTrip,
  saveDraft,
  selectDraftLocation,
  setDraftConfig,
  setDraftDates,
  setDraftTheme,
  startCopyDraft,
  startDraft,
  undoRemoveTrip,
  upcomingTrips,
  type LifecycleState,
  type LifecycleTrip,
  type SampleLocation,
  type TripBuilderDeps,
} from "./trip-lifecycle";
import { TOILETRY_GROUP_ID } from "./toiletry-bag";
import type { Staple, TripConfig } from "./trip";

const TODAY = "2030-03-10";

function makeDeps(overrides: Partial<TripBuilderDeps> = {}): TripBuilderDeps {
  let counter = 0;
  return {
    newId: () => `trip-${++counter}`,
    today: TODAY,
    ...overrides,
  };
}

const CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: true,
  occasionCount: 2,
  reuseNice: false,
  returnOutfit: true,
};

const LOCATION: SampleLocation = {
  id: "sample-a",
  city: "Sampleton",
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: "Sampleton, Sample Region, Sampleland",
};
const OTHER_LOCATION: SampleLocation = {
  ...LOCATION,
  id: "sample-b",
  city: "Exampleville",
  label: "Exampleville, Sample Region, Sampleland",
};

const STAPLES: Staple[] = [
  {
    id: "underwear",
    name: "Underwear",
    category: "Clothing",
    qty: 1,
    cadence: "per day",
    packLast: false,
  },
  {
    id: "last-laptop",
    name: "Laptop",
    category: "Tech",
    qty: 1,
    cadence: "per trip",
    packLast: true,
  },
  {
    id: "toothbrush",
    name: "Toothbrush",
    category: "Bathroom",
    qty: 1,
    cadence: "per trip",
    packLast: true,
  },
  {
    id: "floss",
    name: "Floss",
    category: "Bathroom",
    qty: 1,
    cadence: "per trip",
    packLast: false,
    groupId: TOILETRY_GROUP_ID,
  },
];

const byId = (trip: LifecycleTrip, id: string) => trip.items.find((entry) => entry.id === id);

function savedTrip(
  overrides: Partial<TripBuilderDeps> = {},
  staples: Staple[] = STAPLES,
  config: TripConfig = CONFIG,
): LifecycleTrip {
  const deps = makeDeps(overrides);
  const draft = selectDraftLocation(startDraft(config, "2030-04-01", "2030-04-08"), LOCATION);
  const result = saveDraft(beginDraft(emptyLifecycleState(), draft), staples, deps);
  if (!result.ok) throw new Error(result.reason);
  return result.trip;
}

describe("drafts", () => {
  it("startDraft seeds a create draft with a copy of the config and no confirmed location", () => {
    const config = { ...CONFIG };
    const draft = startDraft(config, "2030-04-01", "2030-04-05");
    expect(draft).toEqual({
      mode: "create",
      sourceId: null,
      location: null,
      start: "2030-04-01",
      end: "2030-04-05",
      config: CONFIG,
      theme: "travel",
    });
    config.laundry = true;
    expect(draft.config.laundry).toBe(false);
  });

  it("normalizes a return date before departure to the departure date", () => {
    const draft = startDraft(CONFIG, "2030-04-05", "2030-04-01");
    expect(draft).toMatchObject({ start: "2030-04-05", end: "2030-04-05" });
    expect(setDraftDates(draft, "2030-05-09", "2030-05-02")).toMatchObject({
      start: "2030-05-09",
      end: "2030-05-09",
    });
  });

  it("selecting a location stores a copy; config edits copy too", () => {
    const location = { ...LOCATION };
    const draft = selectDraftLocation(startDraft(CONFIG, "2030-04-01", "2030-04-05"), location);
    location.city = "Mutated";
    expect(draft.location).toEqual(LOCATION);
    const config = { ...CONFIG, laundry: true };
    const edited = setDraftConfig(draft, config);
    config.laundry = false;
    expect(edited.config.laundry).toBe(true);
  });

  it("a draft is separate from saved trips; cancel discards it and leaves saved trips untouched", () => {
    const trip = savedTrip();
    const state: LifecycleState = { trips: [trip], deletedTrips: [], draft: null };
    const drafting = beginDraft(state, startDraft(CONFIG, "2030-06-01", "2030-06-04"));
    expect(drafting.draft).not.toBeNull();
    expect(drafting.trips).toBe(state.trips);
    const cancelled = cancelDraft(drafting);
    expect(cancelled.draft).toBeNull();
    expect(cancelled.trips).toBe(state.trips);
    expect(cancelDraft(state)).toBe(state);
  });
});

describe("saveDraft", () => {
  it("rejects with no draft", () => {
    const state = emptyLifecycleState();
    expect(saveDraft(state, STAPLES, makeDeps())).toEqual({ ok: false, reason: "NO_DRAFT", state });
  });

  it("rejects until a location object is confirmed", () => {
    const state = beginDraft(emptyLifecycleState(), startDraft(CONFIG, "2030-04-01", "2030-04-05"));
    expect(saveDraft(state, STAPLES, makeDeps())).toEqual({
      ok: false,
      reason: "LOCATION_NOT_CONFIRMED",
      state,
    });
  });

  it("rejects invalid dates", () => {
    const draft = selectDraftLocation(startDraft(CONFIG, "", ""), LOCATION);
    const state = beginDraft(emptyLifecycleState(), draft);
    expect(saveDraft(state, STAPLES, makeDeps())).toEqual({
      ok: false,
      reason: "INVALID_DATES",
      state,
    });
  });

  it("saves a new snapshot at the front, clears the draft, and leaves older trips alone", () => {
    const deps = makeDeps();
    const older = savedTrip();
    const draft = selectDraftLocation(
      startDraft(CONFIG, "2030-05-01", "2030-05-06"),
      OTHER_LOCATION,
    );
    const result = saveDraft({ trips: [older], deletedTrips: [], draft }, STAPLES, deps);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.trips).toEqual([result.trip, older]);
    expect(result.state.trips[1]).toBe(older);
    expect(result.state.draft).toBeNull();
    expect(result.trip).toMatchObject({
      id: "trip-1",
      destination: "Exampleville",
      location: OTHER_LOCATION,
      start: "2030-05-01",
      end: "2030-05-06",
      days: 6,
      dailyDays: 4,
      copiedFrom: null,
      archived: false,
      ready: false,
      toiletryBagPacked: false,
      weather: { status: "pending", label: "Seasonal outlook", suggestion: "Compact umbrella" },
    });
    // A fresh trip starts with no progress and no remembered or suppressed suggestions.
    expect(result.trip.suggestionMemory).toEqual({});
    expect(result.trip.suppressedSuggestions).toEqual({});
    expect(result.trip.items.every((entry) => entry.packed === 0)).toBe(true);
    expect(result.trip.items.some((entry) => "userEdited" in entry)).toBe(false);
  });

  it("uses the normalized dates and the explicit today for the forecast label", () => {
    const deps = makeDeps({ today: "2030-04-28" });
    const draft = selectDraftLocation(
      { ...startDraft(CONFIG, "2030-05-01", "2030-05-06"), end: "2030-04-01" },
      LOCATION,
    );
    const result = saveDraft(beginDraft(emptyLifecycleState(), draft), STAPLES, deps);
    if (!result.ok) throw new Error(result.reason);
    expect(result.trip.end).toBe("2030-05-01");
    expect(result.trip.weather.label).toBe("Close forecast");
  });
});

describe("buildTrip", () => {
  it("builds suggestions, a return outfit, default Pack last items, and sunglasses with no duplicates", () => {
    const trip = savedTrip({}, []);
    expect(findIdentityViolations(trip)).toEqual([]);
    expect(
      trip.items.filter((entry) => entry.section === "return").map((entry) => entry.id),
    ).toEqual(["return-top", "return-bottoms", "return-underwear", "return-socks"]);
    expect(
      trip.items.filter((entry) => entry.section === "packlast").map((entry) => entry.id),
    ).toEqual(["last-laptop", "last-chargers", "last-glasses"]);
    expect(byId(trip, "sunglasses")).toMatchObject({
      qty: 1,
      category: "Accessories",
      section: "main",
    });
    expect(byId(trip, "underwear")?.qty).toBe(7);
    expect(byId(trip, "nice-makeup")?.groupId).toBe(TOILETRY_GROUP_ID);
    expect(trip.items.every((entry) => entry.packed === 0)).toBe(true);
    expect(trip.items.every((entry) => entry.qty >= 1)).toBe(true);
  });

  it("omits the return outfit when it is off; return underwear is never merged with everyday underwear", () => {
    const off = savedTrip({}, [], { ...CONFIG, returnOutfit: false });
    expect(off.items.some((entry) => entry.section === "return")).toBe(false);
    const on = savedTrip({}, []);
    expect(byId(on, "underwear")?.section).toBe("main");
    expect(byId(on, "return-underwear")?.section).toBe("return");
  });

  it("merges staples: per-day and per-trip quantities, spare underwear, Pack last, Bathroom membership", () => {
    const trip = savedTrip({}, STAPLES);
    expect(findIdentityViolations(trip)).toEqual([]);
    // per-day staple overrides the calculated row: 6 daily days x 1 + spare 1
    expect(byId(trip, "underwear")).toMatchObject({
      qty: 7,
      category: "Clothing",
      section: "main",
    });
    expect(byId(trip, "last-laptop")).toMatchObject({ category: "Tech", section: "packlast" });
    expect(trip.items.filter((entry) => entry.name === "Laptop")).toHaveLength(1);
    expect(byId(trip, "toothbrush")).toMatchObject({
      section: "packlast",
      groupId: TOILETRY_GROUP_ID,
    });
    expect(byId(trip, "floss")).toMatchObject({ section: "main", groupId: TOILETRY_GROUP_ID });
  });

  it("spare applies to socks staples only when enabled", () => {
    const socks: Staple[] = [
      {
        id: "socks",
        name: "Socks",
        category: "Clothing",
        qty: 1,
        cadence: "per day",
        packLast: false,
      },
    ];
    expect(byId(savedTrip({}, socks), "socks")?.qty).toBe(7);
    expect(byId(savedTrip({}, socks, { ...CONFIG, spare: false }), "socks")?.qty).toBe(6);
  });

  it("an equivalent Makeup / Dress shoes staple replaces the suggestion instead of duplicating it", () => {
    const staples: Staple[] = [
      {
        id: "my-makeup",
        name: "Make-up kit",
        category: "Bathroom",
        qty: 1,
        cadence: "per trip",
        packLast: false,
      },
      {
        id: "my-shoes",
        name: "Dress shoes",
        category: "Nice attire",
        qty: 1,
        cadence: "per trip",
        packLast: false,
      },
    ];
    const trip = savedTrip({}, staples);
    expect(findIdentityViolations(trip)).toEqual([]);
    expect(byId(trip, "nice-makeup")).toBeUndefined();
    expect(byId(trip, "my-makeup")).toMatchObject({
      name: "Make-up kit",
      groupId: TOILETRY_GROUP_ID,
    });
    expect(byId(trip, "my-shoes")).toMatchObject({ name: "Dress shoes", optional: true });
  });

  it("a staple matching by id keeps a Makeup row in the Bathroom group", () => {
    const staples: Staple[] = [
      {
        id: "nice-makeup",
        name: "Makeup",
        category: "Other",
        qty: 2,
        cadence: "per trip",
        packLast: true,
      },
    ];
    const trip = savedTrip({}, staples);
    expect(byId(trip, "nice-makeup")).toMatchObject({
      qty: 2,
      category: "Other",
      section: "packlast",
      groupId: TOILETRY_GROUP_ID,
    });
  });

  it("a staple that matches a return-outfit row keeps its return timing", () => {
    const staples: Staple[] = [
      {
        id: "return-top",
        name: "Travel top",
        category: "Clothing",
        qty: 2,
        cadence: "per trip",
        packLast: true,
      },
    ];
    expect(byId(savedTrip({}, staples), "return-top")).toMatchObject({
      name: "Travel top",
      qty: 2,
      section: "return",
    });
  });

  it("a staple resolving to zero quantity leaves no phantom row (zero means absent)", () => {
    const staples: Staple[] = [
      {
        id: "extra-socks",
        name: "Extra socks",
        category: "Clothing",
        qty: 1,
        cadence: "per day",
        packLast: false,
      },
      {
        id: "last-laptop",
        name: "Laptop",
        category: "Tech",
        qty: 0,
        cadence: "per trip",
        packLast: true,
      },
    ];
    const deps = makeDeps();
    const trip = buildTrip("Short stay", null, "2030-04-01", "2030-04-02", CONFIG, staples, deps);
    expect(byId(trip, "extra-socks")).toBeUndefined();
    expect(byId(trip, "last-laptop")).toBeUndefined();
    expect(trip.items.every((entry) => entry.qty >= 1)).toBe(true);
    expect(trip.location).toBeNull();
  });

  it("tags the default Bathroom names as toiletry contents and drops stale groups from matched staples", () => {
    const trip = savedTrip({}, [
      {
        id: "last-chargers",
        name: "Chargers",
        category: "Tech",
        qty: 1,
        cadence: "per trip",
        packLast: true,
      },
    ]);
    expect(byId(trip, "last-chargers")?.groupId).toBeFalsy();
    const bathroom = buildTrip(
      "X",
      null,
      "2030-04-01",
      "2030-04-05",
      CONFIG,
      [
        {
          id: "contacts",
          name: "Contacts",
          category: "Other",
          qty: 1,
          cadence: "per trip",
          packLast: true,
        },
        {
          id: "deodorant",
          name: "deodorant",
          category: "Bathroom",
          qty: 1,
          cadence: "per trip",
          packLast: false,
        },
      ],
      makeDeps(),
    );
    expect(byId(bathroom, "contacts")?.groupId).toBe(TOILETRY_GROUP_ID);
    expect(byId(bathroom, "deodorant")?.groupId).toBe(TOILETRY_GROUP_ID);
  });
});

describe("themes", () => {
  it("a new draft is Travel, and choosing a theme changes only the theme", () => {
    const draft = startDraft(CONFIG, "2030-04-01", "2030-04-05");
    expect(draft.theme).toBe("travel");
    const chosen = setDraftTheme(draft, "beach");
    expect(chosen).toEqual({ ...draft, theme: "beach" });
    expect(draft.theme).toBe("travel");
  });

  it("a draft can start on a theme", () => {
    expect(startDraft(CONFIG, "2030-04-01", "2030-04-05", "city").theme).toBe("city");
  });

  it("saving gives the trip the draft's theme (Travel by default)", () => {
    const place = {
      id: "p",
      city: "Anywhere",
      region: "",
      country: "Land",
      countryCode: "LD",
      label: "Anywhere, Land",
    };
    const build = (theme?: Parameters<typeof setDraftTheme>[1]) => {
      const base = selectDraftLocation(startDraft(CONFIG, "2030-04-01", "2030-04-05"), place);
      const state = beginDraft(emptyLifecycleState(), theme ? setDraftTheme(base, theme) : base);
      const saved = saveDraft(state, STAPLES, makeDeps());
      if (!saved.ok) throw new Error(saved.reason);
      return saved.trip;
    };
    expect(build().theme).toBe("travel");
    expect(build("outdoors").theme).toBe("outdoors");
  });

  it("a copy starts from the source's theme and the draft can still change it", () => {
    const source = { ...savedTrip(), theme: "theme_park" as const };
    const draft = startCopyDraft(source, "2030-07-01", "2030-07-04");
    expect(draft.theme).toBe("theme_park");
    expect(setDraftTheme(draft, "home").theme).toBe("home");
    expect(source.theme).toBe("theme_park");
  });
});

describe("copy", () => {
  function progressedSource(): LifecycleTrip {
    const base = savedTrip();
    return {
      ...base,
      items: base.items.map((entry) => ({ ...entry, packed: entry.qty, userEdited: true })),
      toiletryBagPacked: true,
      ready: true,
      archived: true,
      weather: { ...base.weather, status: "accepted" },
      suggestionMemory: { "nice-shoes": { ...base.items[0], name: "Remembered" } },
      suppressedSuggestions: { "nice-makeup": true },
    };
  }

  it("seeds a draft from the source preference config only and requires a new location and dates", () => {
    const source = progressedSource();
    const draft = startCopyDraft(source, "2030-07-01", "2030-07-04");
    expect(draft).toEqual({
      mode: "copy",
      sourceId: source.id,
      location: null,
      start: "2030-07-01",
      end: "2030-07-04",
      config: source.config,
      theme: source.theme,
    });
    expect(draft.config).not.toBe(source.config);
    const state = beginDraft({ trips: [source], deletedTrips: [], draft: null }, draft);
    expect(saveDraft(state, STAPLES, makeDeps())).toMatchObject({
      ok: false,
      reason: "LOCATION_NOT_CONFIRMED",
    });
  });

  it("saving recalculates, resets every progress field, records copiedFrom, and leaves the source deep-equal", () => {
    const source = progressedSource();
    const snapshot = structuredClone(source);
    const deps = makeDeps({ newId: () => "copy-1" });
    const draft = selectDraftLocation(
      startCopyDraft(source, "2030-07-01", "2030-07-03"),
      OTHER_LOCATION,
    );
    const result = saveDraft({ trips: [source], deletedTrips: [], draft }, STAPLES, deps);
    if (!result.ok) throw new Error(result.reason);
    const copy = result.trip;

    expect(copy.items.every((entry) => entry.packed === 0)).toBe(true);
    expect(copy.items.some((entry) => entry.userEdited)).toBe(false);
    expect(copy).toMatchObject({
      toiletryBagPacked: false,
      ready: false,
      archived: false,
      copiedFrom: source.id,
      destination: "Exampleville",
      days: 3,
      weather: { status: "pending" },
    });
    // toMatchObject treats {} as "any object", so the empty-state fields need strict equality.
    expect(copy.suggestionMemory).toEqual({});
    expect(copy.suppressedSuggestions).toEqual({});
    expect(copy.weather).toEqual({
      status: "pending",
      label: "Seasonal outlook",
      suggestion: "Compact umbrella",
    });
    expect(copy.id).not.toBe(source.id);
    expect(byId(copy, "nice-makeup")).toBeDefined();
    expect(byId(copy, "underwear")?.qty).toBe(2);
    expect(result.state.trips[1]).toBe(source);
    expect(source).toEqual(snapshot);
  });
});

describe("classification", () => {
  const trip = (end: string, archived = false) => ({ end, archived });

  it.each([
    ["end == today is still upcoming", trip(TODAY), "upcoming"],
    ["end == today - 1 is past", trip("2030-03-09"), "past"],
    ["end in the future is upcoming", trip("2030-03-11"), "upcoming"],
    ["archived future trip", trip("2030-06-01", true), "archived"],
    ["archived past trip stays archived", trip("2020-01-01", true), "archived"],
    ["month boundary", trip("2030-02-28"), "past"],
    ["year boundary", trip("2029-12-31"), "past"],
  ])("%s", (_name, input, expected) => {
    expect(classifyTrip(input, TODAY)).toBe(expected);
  });

  it.each([
    ["malformed end", "soon", TODAY],
    ["impossible end date", "2030-02-30", TODAY],
    ["empty end", "", TODAY],
    ["malformed today", "2000-01-01", "later"],
  ])("%s is never past", (_name, end, today) => {
    expect(isPastTrip({ end }, today)).toBe(false);
  });

  it("Ready has no effect on classification", () => {
    const base = { ...savedTrip(), end: "2030-03-09" };
    const ready: LifecycleTrip = { ...base, ready: true };
    const notReady: LifecycleTrip = { ...base, ready: false };
    expect(classifyTrip(ready, TODAY)).toBe("past");
    expect(classifyTrip(notReady, TODAY)).toBe("past");
  });

  it("splits lists into upcoming and past & archived", () => {
    const upcoming = { ...savedTrip(), id: "u", end: "2030-05-01" };
    const past = { ...upcoming, id: "p", end: "2030-01-01" };
    const archived = { ...upcoming, id: "a", archived: true };
    const trips = [upcoming, past, archived];
    expect(upcomingTrips(trips, TODAY).map((entry) => entry.id)).toEqual(["u"]);
    expect(pastAndArchivedTrips(trips, TODAY).map((entry) => entry.id)).toEqual(["p", "a"]);
  });
});

describe("archive / restore", () => {
  const future = { ...savedTrip(), id: "future", end: "2030-06-01" };
  const past = { ...savedTrip(), id: "past", end: "2030-01-01" };
  const state: LifecycleState = { trips: [future, past], deletedTrips: [], draft: null };

  it("archiving sets a manual flag independent of Ready and keeps packing progress", () => {
    const ready = {
      ...future,
      ready: true,
      toiletryBagPacked: true,
      items: future.items.map((entry) => ({ ...entry, packed: entry.qty })),
    };
    const result = archiveTrip({ ...state, trips: [ready, past] }, "future");
    if (!result.ok) throw new Error(result.reason);
    expect(result.trip).toMatchObject({ archived: true, ready: true, toiletryBagPacked: true });
    expect(result.trip.items).toEqual(ready.items);
    expect(result.state.trips[1]).toBe(past);
    expect(classifyTrip(result.trip, TODAY)).toBe("archived");
  });

  it("restoring an archived future trip returns it to Upcoming", () => {
    const archived = archiveTrip(state, "future");
    if (!archived.ok) throw new Error(archived.reason);
    const restored = restoreTrip(archived.state, "future");
    if (!restored.ok) throw new Error(restored.reason);
    expect(classifyTrip(restored.trip, TODAY)).toBe("upcoming");
    expect(restored.trip.archived).toBe(false);
  });

  it("restoring an archived past trip clears the flag but it stays past by date", () => {
    const archived = archiveTrip(state, "past");
    if (!archived.ok) throw new Error(archived.reason);
    const restored = restoreTrip(archived.state, "past");
    if (!restored.ok) throw new Error(restored.reason);
    expect(classifyTrip(restored.trip, TODAY)).toBe("past");
  });

  it("archive and restore are idempotent and report unknown ids", () => {
    const archived = archiveTrip(state, "future");
    if (!archived.ok) throw new Error(archived.reason);
    const again = archiveTrip(archived.state, "future");
    expect(again.state).toBe(archived.state);
    expect(restoreTrip(state, "future").state).toBe(state);
    expect(archiveTrip(state, "nope")).toEqual({ ok: false, reason: "TRIP_NOT_FOUND", state });
    expect(restoreTrip(state, "nope")).toEqual({ ok: false, reason: "TRIP_NOT_FOUND", state });
  });
});

describe("remove / undo", () => {
  const a = { ...savedTrip(), id: "a" };
  const b = { ...savedTrip(), id: "b" };
  const state: LifecycleState = { trips: [a, b], deletedTrips: [], draft: null };

  it("remove moves the trip to Recently deleted, newest first, with deletedAt", () => {
    const first = removeTrip(state, "a", 100);
    if (!first.ok) throw new Error(first.reason);
    const second = removeTrip(first.state, "b", 200);
    if (!second.ok) throw new Error(second.reason);
    expect(first.state.trips).toEqual([b]);
    expect(second.state.trips).toEqual([]);
    expect(second.state.deletedTrips).toEqual([
      { trip: b, deletedAt: 200 },
      { trip: a, deletedAt: 100 },
    ]);
    expect(state.trips).toEqual([a, b]);
  });

  it("remove reports an unknown id", () => {
    expect(removeTrip(state, "nope", 1)).toEqual({ ok: false, reason: "TRIP_NOT_FOUND", state });
  });

  it("undo restores the exact removed trip; a second undo is a no-op", () => {
    const removed = removeTrip(state, "a", 100);
    if (!removed.ok) throw new Error(removed.reason);
    const restored = undoRemoveTrip(removed.state, "a");
    expect(restored.trips).toEqual([b, a]);
    expect(restored.trips[1]).toBe(a);
    expect(restored.deletedTrips).toEqual([]);
    expect(undoRemoveTrip(restored, "a")).toBe(restored);
  });

  it("undo of an unknown id changes nothing", () => {
    expect(undoRemoveTrip(state, "nope")).toBe(state);
  });

  it("undo never duplicates a trip whose id is already present", () => {
    const removed = removeTrip(state, "a", 100);
    if (!removed.ok) throw new Error(removed.reason);
    const reinserted = {
      ...removed.state,
      trips: [...removed.state.trips, { ...a, destination: "Replacement" }],
    };
    const result = undoRemoveTrip(reinserted, "a");
    expect(result.trips.filter((entry) => entry.id === "a")).toHaveLength(1);
    expect(result.trips.find((entry) => entry.id === "a")?.destination).toBe("Replacement");
    expect(result.deletedTrips).toEqual([]);
  });

  it("purgeDeletedTrips is a policy-free seam", () => {
    const removed = removeTrip(removeTrip(state, "a", 100).state, "b", 200);
    const withDeleted = removed.state;
    expect(purgeDeletedTrips(withDeleted, () => false)).toBe(withDeleted);
    const purged = purgeDeletedTrips(withDeleted, (entry) => entry.deletedAt < 150);
    expect(purged.deletedTrips.map((entry) => entry.trip.id)).toEqual(["b"]);
  });
});
