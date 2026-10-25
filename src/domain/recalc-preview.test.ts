import { describe, expect, it } from "vitest";
import { calculateSuggestions as suggest } from "./calc";
import { editItem, recalculateSuggestions, removeTripItem } from "./item-ops";
import { configsEqual, previewRecalculation } from "./recalc-preview";
import { setPacked } from "./readiness";
import type { Staple, Trip, TripConfig, TripItem } from "./trip";

const CONFIG: TripConfig = {
  laundry: false,
  spare: false,
  niceAttire: true,
  occasionCount: 2,
  reuseNice: false,
  returnOutfit: true,
};
const NO_STAPLES: Staple[] = [];

const manual = (id: string, name: string, qty: number): TripItem => ({
  id,
  name,
  category: "Tech",
  qty,
  packed: 0,
  section: "main",
});

/** A synthetic 8-day trip (fictional dates) with a list built by the calculator plus two kinds of item it never owns. */
function makeTrip(over: Partial<Trip> = {}, config: TripConfig = CONFIG): Trip {
  const built = suggest({ ...config, start: "2030-03-01", end: "2030-03-08" });
  const items = built.items.map((entry): TripItem => ({
    id: entry.id,
    name: entry.name,
    category: entry.category,
    qty: entry.qty,
    packed: 0,
    section: "main",
    optional: Boolean(entry.optional),
  }));
  return {
    id: "trip-a",
    start: "2030-03-01",
    end: "2030-03-08",
    stops: [],
    config,
    days: built.days,
    dailyDays: built.dailyDays,
    items: [
      ...items,
      manual("custom-camera", "Camera", 1),
      manual("saved:list-1:charger", "Phone charger", 2),
    ],
    suggestionMemory: {},
    suppressedSuggestions: {},
    weather: { status: "pending", label: "", suggestion: "Compact umbrella" },
    toiletryBagPacked: false,
    ready: false,
    ...over,
  };
}

/** The same trip after the weather review split its clothing: short-sleeve tops and shorts stand in for Everyday tops and bottoms. */
function weatherTrip(): Trip {
  const base = makeTrip();
  return {
    ...base,
    items: [
      ...base.items.filter((entry) => entry.id !== "tops" && entry.id !== "bottoms"),
      { ...manual("tops-short", "Short-sleeve tops", 4), category: "Clothing" },
      { ...manual("bottoms-shorts", "Shorts", 2), category: "Clothing" },
    ],
  };
}

const find = (trip: Trip, id: string) => trip.items.find((entry) => entry.id === id);
const pack = (trip: Trip, id: string, count: number) => setPacked(trip, id, count).trip;

describe("previewRecalculation: it is the recalculation, described", () => {
  const changes: TripConfig[] = [
    { ...CONFIG, laundry: true },
    { ...CONFIG, spare: true },
    { ...CONFIG, niceAttire: false },
    { ...CONFIG, occasionCount: 5 },
    { ...CONFIG, reuseNice: true },
    { ...CONFIG, returnOutfit: false },
    { ...CONFIG, laundry: true, niceAttire: false, returnOutfit: false },
    { ...CONFIG, niceAttire: false, reuseNice: true, occasionCount: 1, spare: true },
    CONFIG,
  ];

  it.each(changes.map((config, index) => [index, config] as const))(
    "change %i: `next` is exactly what recalculateSuggestions makes, item for item",
    (_index, config) => {
      let trip = makeTrip();
      trip = pack(trip, "underwear", 3);
      const preview = previewRecalculation(trip, config, suggest);
      expect(preview.next).toEqual(recalculateSuggestions(trip, config, suggest));
    },
  );

  it.each(changes.map((config, index) => [index, config] as const))(
    "change %i: manual, saved-list and weather items are untouched, packed counts included",
    (_index, config) => {
      let trip = weatherTrip();
      trip = pack(trip, "custom-camera", 1);
      trip = pack(trip, "saved:list-1:charger", 2);
      trip = pack(trip, "tops-short", 3);
      const preview = previewRecalculation(trip, config, suggest);
      // A list the weather review split keeps its split clothing: Everyday tops and bottoms are not added beside it.
      expect(find(preview.next, "tops")).toBeUndefined();
      for (const id of ["custom-camera", "saved:list-1:charger", "tops-short", "bottoms-shorts"]) {
        expect(find(preview.next, id)).toEqual(find(trip, id));
        expect(preview.stays.find((line) => line.id === id)?.why).toBe("added by you");
      }
    },
  );

  it("every item of the old list is accounted for exactly once: updated, removed, or staying", () => {
    let trip = makeTrip();
    trip = pack(trip, "tops", 4);
    const preview = previewRecalculation(
      trip,
      { ...CONFIG, niceAttire: false, laundry: true },
      suggest,
    );
    const ids = [
      ...preview.updated.map((line) => line.id),
      ...preview.removed.map((line) => line.id),
      ...preview.stays.map((line) => line.id),
    ];
    expect([...ids].sort()).toEqual(trip.items.map((entry) => entry.id).sort());
  });

  it("reports no change for the same preferences", () => {
    const trip = makeTrip();
    const preview = previewRecalculation(trip, { ...CONFIG }, suggest);
    expect(preview.configChanged).toBe(false);
    expect(preview.updated).toEqual([]);
    expect(preview.removed).toEqual([]);
    expect(preview.added).toEqual([]);
    expect(preview.needsAcknowledgement).toBe(false);
    expect(configsEqual(CONFIG, { ...CONFIG })).toBe(true);
    expect(configsEqual(CONFIG, { ...CONFIG, occasionCount: 3 })).toBe(false);
  });
});

describe("previewRecalculation: untouched suggestions update, and say how", () => {
  it("laundry on halves the tops target and quarters the bottoms", () => {
    const trip = makeTrip();
    const preview = previewRecalculation(trip, { ...CONFIG, laundry: true }, suggest);
    expect(preview.updated).toEqual([
      { id: "tops", name: "Everyday tops", fromQty: 6, toQty: 3 },
      { id: "bottoms", name: "Everyday bottoms", fromQty: 3, toQty: 2 },
    ]);
    expect(preview.packedReduced).toEqual([]);
    expect(preview.needsAcknowledgement).toBe(false);
  });

  it("a packed count above the new target is lowered to it, shown, and needs an acknowledgement", () => {
    let trip = makeTrip();
    trip = pack(trip, "tops", 5);
    const preview = previewRecalculation(trip, { ...CONFIG, laundry: true }, suggest);
    expect(preview.updated[0]).toEqual({
      id: "tops",
      name: "Everyday tops",
      fromQty: 6,
      toQty: 3,
      packedFrom: 5,
      packedTo: 3,
    });
    expect(preview.packedReduced).toEqual([{ id: "tops", name: "Everyday tops", from: 5, to: 3 }]);
    expect(preview.needsAcknowledgement).toBe(true);
    expect(find(preview.next, "tops")?.packed).toBe(3);
  });

  it("a packed count at or under the new target is kept, and nothing else lowers one", () => {
    let trip = makeTrip();
    trip = pack(trip, "tops", 2);
    trip = pack(trip, "underwear", 6);
    const preview = previewRecalculation(trip, { ...CONFIG, laundry: true }, suggest);
    expect(find(preview.next, "tops")?.packed).toBe(2);
    expect(find(preview.next, "underwear")?.packed).toBe(6);
    expect(preview.packedReduced).toEqual([]);
  });

  it("the return outfit off gives the checkout day an everyday look: more underwear, nothing lowered", () => {
    const trip = makeTrip();
    const preview = previewRecalculation(trip, { ...CONFIG, returnOutfit: false }, suggest);
    expect(preview.updated.find((line) => line.id === "underwear")).toMatchObject({
      fromQty: 6,
      toQty: 7,
    });
    expect(preview.packedReduced).toEqual([]);
  });
});

describe("previewRecalculation: the user's own work stays", () => {
  it("an edited suggestion keeps its edits and is listed as staying", () => {
    const base = makeTrip();
    const edited = editItem(base, NO_STAPLES, "tops", {
      name: "Linen tops",
      qty: 9,
      timing: "main",
      scope: "this-trip",
    });
    if (!edited.ok) throw new Error(edited.reason);
    const preview = previewRecalculation(edited.trip, { ...CONFIG, laundry: true }, suggest);
    expect(find(preview.next, "tops")).toMatchObject({
      name: "Linen tops",
      qty: 9,
      userEdited: true,
    });
    expect(preview.stays).toContainEqual({ id: "tops", name: "Linen tops", why: "edited by you" });
    expect(preview.updated.map((line) => line.id)).not.toContain("tops");
  });

  it("a removed optional suggestion is not re-added, and is listed as not re-added", () => {
    const removed = removeTripItem(makeTrip(), NO_STAPLES, "nice-shoes", "this-trip");
    if (!removed.ok) throw new Error(removed.reason);
    const preview = previewRecalculation(removed.trip, { ...CONFIG, occasionCount: 3 }, suggest);
    expect(find(preview.next, "nice-shoes")).toBeUndefined();
    expect(preview.added.map((line) => line.id)).not.toContain("nice-shoes");
    expect(preview.suppressed).toEqual([{ id: "nice-shoes", name: "Dress shoes" }]);
    expect(preview.next.suppressedSuggestions).toEqual({ "nice-shoes": true });
  });

  it("turning Nice outfits off removes the nice items, with a packed or edited one flagged; turning it back on restores them with their packed counts", () => {
    let trip = makeTrip();
    trip = pack(trip, "nice-top", 1);
    const off = previewRecalculation(trip, { ...CONFIG, niceAttire: false }, suggest);
    const gone = off.removed.map((line) => line.id).sort();
    expect(gone).toEqual(["nice-bottom", "nice-shoes", "nice-top"]);
    expect(off.removed.find((line) => line.id === "nice-top")).toMatchObject({
      qty: 2,
      packed: 1,
      edited: false,
    });
    expect(off.needsAcknowledgement).toBe(true);
    // Nothing is lost: the remembered items come back, packed count and all.
    const back = previewRecalculation(off.next, CONFIG, suggest);
    expect(find(back.next, "nice-top")).toMatchObject({ qty: 2, packed: 1 });
    expect(back.added.map((line) => line.id)).toContain("nice-top");
  });

  it("removing only unpacked, unedited suggestions needs no acknowledgement", () => {
    const preview = previewRecalculation(makeTrip(), { ...CONFIG, niceAttire: false }, suggest);
    expect(preview.removed.length).toBeGreaterThan(0);
    expect(preview.needsAcknowledgement).toBe(false);
  });

  it("removing an edited but unpacked suggestion still needs acknowledgement", () => {
    const edited = editItem(makeTrip(), NO_STAPLES, "nice-shoes", {
      name: "My formal shoes",
      qty: 1,
      timing: "main",
      scope: "this-trip",
    });
    if (!edited.ok) throw new Error(edited.reason);
    const preview = previewRecalculation(edited.trip, { ...CONFIG, niceAttire: false }, suggest);
    expect(preview.removed.find((line) => line.id === "nice-shoes")).toMatchObject({
      name: "My formal shoes",
      packed: 0,
      edited: true,
    });
    expect(preview.needsAcknowledgement).toBe(true);
  });
});

describe("previewRecalculation: Ready and the toiletry bag", () => {
  it("says Ready turns off only when the trip is Ready", () => {
    expect(
      previewRecalculation(makeTrip({ ready: true }), { ...CONFIG, laundry: true }, suggest)
        .readyWillRevoke,
    ).toBe(true);
    const calm = previewRecalculation(
      makeTrip({ ready: false }),
      { ...CONFIG, laundry: true },
      suggest,
    );
    expect(calm.readyWillRevoke).toBe(false);
    expect(calm.next.ready).toBe(false);
  });

  it("revokes Ready in the applied trip whatever the change", () => {
    const preview = previewRecalculation(
      makeTrip({ ready: true }),
      { ...CONFIG, spare: true },
      suggest,
    );
    expect(preview.next.ready).toBe(false);
  });

  it("does not reset the bag when preference recalculation changes only generated clothing", () => {
    const placed = makeTrip({ toiletryBagPacked: true });
    const off = previewRecalculation(placed, { ...CONFIG, niceAttire: false }, suggest);
    expect(off.bagWillReset).toBe(false);
    expect(off.bathroomChanges).toEqual([]);
    expect(off.next.toiletryBagPacked).toBe(true);

    const laundry = previewRecalculation(placed, { ...CONFIG, laundry: true }, suggest);
    expect(laundry.bagWillReset).toBe(false);
    expect(laundry.bathroomChanges).toEqual([]);
    expect(laundry.next.toiletryBagPacked).toBe(true);
  });

  it("does not claim a reset when the bag was not placed", () => {
    const preview = previewRecalculation(makeTrip(), { ...CONFIG, niceAttire: false }, suggest);
    expect(preview.bathroomChanges).toEqual([]);
    expect(preview.bagWillReset).toBe(false);
  });

  it("does not add a personal Bathroom line when Nice outfits are enabled", () => {
    const base = makeTrip({}, { ...CONFIG, niceAttire: false });
    const preview = previewRecalculation(
      { ...base, toiletryBagPacked: true },
      { ...CONFIG, niceAttire: true },
      suggest,
    );
    expect(preview.bathroomChanges).toEqual([]);
    expect(preview.bagWillReset).toBe(false);
  });
});
