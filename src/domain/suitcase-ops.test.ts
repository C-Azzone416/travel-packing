// Cubes, Morning of and laundry-aware recalculation (#378).

import { describe, expect, it } from "vitest";
import { buildTripItems, calculateSuggestions as suggest } from "./calc";
import {
  cubesInUse,
  editItem,
  moveItemToCube,
  recalculateSuggestions,
  rememberPreview,
  setMorningOf,
} from "./item-ops";
import { morningOfCubesFor } from "./cubes";
import { previewRecalculation } from "./recalc-preview";
import type { Staple, Trip, TripConfig } from "./trip";

const CONFIG: TripConfig = {
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

const STAPLES: Staple[] = [
  {
    id: "tops",
    name: "Tops",
    qty: 1,
    cadence: "per day",
    category: "Clothing",
    packLast: false,
    laundryHalves: true,
  },
  {
    id: "underwear",
    name: "Underwear",
    qty: 1,
    cadence: "per day",
    category: "Clothing",
    packLast: false,
  },
  {
    id: "medicine",
    name: "Medication",
    qty: 1,
    cadence: "per day",
    category: "Bathroom",
    packLast: false,
  },
  {
    id: "lens",
    name: "Lens",
    qty: 1,
    cadence: "per night",
    category: "Bathroom",
    packLast: false,
    laundryHalves: true,
  },
  {
    id: "chargers",
    name: "Chargers",
    qty: 5,
    cadence: "per trip",
    category: "Tech",
    packLast: true,
    laundryHalves: true,
  },
];

function makeTrip(config: TripConfig = CONFIG, staples: Staple[] = STAPLES): Trip {
  const built = buildTripItems({ ...config, start: "2030-03-01", end: "2030-03-08" }, staples);
  return {
    id: "trip-a",
    start: "2030-03-01",
    end: "2030-03-08",
    stops: [],
    config,
    days: built.days,
    dailyDays: built.dailyDays,
    items: built.items,
    suggestionMemory: {},
    suppressedSuggestions: {},
    weather: { status: "pending", label: "", suggestion: "Compact umbrella" },
    toiletryBagPacked: false,
    ready: false,
  };
}
const qty = (trip: Trip, id: string) => trip.items.find((item) => item.id === id)?.qty;
const LAUNDRY: TripConfig = { ...CONFIG, laundry: true };

describe("recalculating Staple rows (the new model)", () => {
  it("halves laundry Staples, rounding up, when laundry is turned on", () => {
    const trip = makeTrip();
    expect(qty(trip, "tops")).toBe(7);
    expect(qty(trip, "chargers")).toBe(5);
    const next = recalculateSuggestions(trip, LAUNDRY, suggest);
    expect(qty(next, "tops")).toBe(4);
    expect(qty(next, "lens")).toBe(4);
    expect(qty(next, "chargers")).toBe(3);
    expect(next.items.find((item) => item.id === "chargers")?.stapleCadence).toBe("per trip");
  });

  it("restores the quantities when laundry is turned off again", () => {
    const back = recalculateSuggestions(
      recalculateSuggestions(makeTrip(), LAUNDRY, suggest),
      CONFIG,
      suggest,
    );
    expect(qty(back, "tops")).toBe(7);
    expect(qty(back, "lens")).toBe(7);
    expect(qty(back, "chargers")).toBe(5);
  });

  it("never halves underwear, and the spare follows the trip preference", () => {
    const trip = makeTrip();
    expect(qty(trip, "underwear")).toBe(7);
    const next = recalculateSuggestions(trip, { ...LAUNDRY, spare: true }, suggest);
    expect(qty(next, "underwear")).toBe(8);
  });

  it("follows the return outfit (days - 1) for everyday clothing and not for other Staples", () => {
    const next = recalculateSuggestions(makeTrip(), { ...CONFIG, returnOutfit: false }, suggest);
    expect(qty(next, "tops")).toBe(8);
    expect(qty(next, "underwear")).toBe(8);
    expect(qty(next, "medicine")).toBe(8);
    expect(qty(makeTrip(), "medicine")).toBe(8);
  });

  it("keeps the packed count, lowered only to the new quantity", () => {
    const trip = makeTrip();
    const packed = {
      ...trip,
      items: trip.items.map((item) =>
        item.id === "tops" || item.id === "lens" ? { ...item, packed: 6 } : item,
      ),
    };
    const next = recalculateSuggestions(packed, LAUNDRY, suggest);
    expect(next.items.find((item) => item.id === "tops")?.packed).toBe(4);
    expect(next.items.find((item) => item.id === "lens")?.packed).toBe(4);
    const same = recalculateSuggestions(packed, { ...CONFIG, spare: true }, suggest);
    expect(same.items.find((item) => item.id === "lens")?.packed).toBe(6);
  });

  it("leaves a Staple row the person edited alone", () => {
    const trip = makeTrip();
    const edited = {
      ...trip,
      items: trip.items.map((item) =>
        item.id === "tops" ? { ...item, qty: 9, userEdited: true } : item,
      ),
    };
    expect(qty(recalculateSuggestions(edited, LAUNDRY, suggest), "tops")).toBe(9);
  });

  it("leaves old rows without a saved per-unit quantity alone (existing trips keep their items)", () => {
    const trip = makeTrip();
    const legacy = {
      ...trip,
      items: trip.items.map((item) => {
        const { stapleQty: _qty, laundryHalves: _flag, ...rest } = item;
        void _qty;
        void _flag;
        return item.id === "lens" || item.id === "chargers" ? rest : item;
      }),
    };
    const next = recalculateSuggestions(legacy, LAUNDRY, suggest);
    expect(qty(next, "lens")).toBe(7);
    expect(qty(next, "chargers")).toBe(5);
  });

  it("drops a per-night row when the trip has no nights", () => {
    const sameDay = recalculateSuggestions(makeTrip(), CONFIG, (input) =>
      suggest({ ...input, end: input.start }),
    );
    expect(sameDay.items.some((item) => item.id === "lens")).toBe(false);
    expect(qty(sameDay, "chargers")).toBe(5);
  });

  it("keeps a Smart snapshot on the old calculator path", () => {
    const smart: Staple[] = [
      { id: "tops", name: "Tops", qty: 1, cadence: "smart", category: "Clothing", packLast: false },
    ];
    const next = recalculateSuggestions(makeTrip(CONFIG, smart), LAUNDRY, suggest);
    expect(qty(next, "tops")).toBe(Math.ceil(7 / 2));
    expect(next.items.find((item) => item.id === "tops")?.stapleCadence).toBe("smart");
  });

  it("keeps the cube a person chose for a calculated row", () => {
    const moved = moveItemToCube(makeTrip(), "sleepwear", "misc");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const next = recalculateSuggestions(moved.trip, LAUNDRY, suggest);
    expect(next.items.find((item) => item.id === "sleepwear")?.cube).toBe("misc");
  });
});

describe("recalculation preview with the new model", () => {
  it("lists a laundry Staple as updated, not as added by you", () => {
    const preview = previewRecalculation(makeTrip(), LAUNDRY, suggest);
    expect(preview.updated).toContainEqual(
      expect.objectContaining({ id: "tops", fromQty: 7, toQty: 4 }),
    );
    expect(preview.updated).toContainEqual(
      expect.objectContaining({ id: "chargers", fromQty: 5, toQty: 3 }),
    );
    expect(preview.stays.find((line) => line.id === "tops")).toBeUndefined();
    expect(preview.stays.find((line) => line.id === "underwear")).toMatchObject({
      why: "unchanged",
    });
  });

  it("reports a lowered packed count and needs acknowledgement", () => {
    const trip = makeTrip();
    const packed = {
      ...trip,
      items: trip.items.map((item) => (item.id === "tops" ? { ...item, packed: 7 } : item)),
    };
    const preview = previewRecalculation(packed, LAUNDRY, suggest);
    expect(preview.packedReduced).toContainEqual({ id: "tops", name: "Tops", from: 7, to: 4 });
    expect(preview.needsAcknowledgement).toBe(true);
  });

  it("shows an edited Staple row as edited by you", () => {
    const trip = makeTrip();
    const edited = {
      ...trip,
      items: trip.items.map((item) => (item.id === "tops" ? { ...item, userEdited: true } : item)),
    };
    expect(
      previewRecalculation(edited, LAUNDRY, suggest).stays.find((line) => line.id === "tops")?.why,
    ).toBe("edited by you");
  });
});

describe("moving an item to another cube", () => {
  it("changes only the cube", () => {
    const trip = { ...makeTrip(), ready: true };
    const result = moveItemToCube(trip, "chargers", "documents");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = trip.items.find((item) => item.id === "chargers")!;
    const after = result.trip.items.find((item) => item.id === "chargers")!;
    expect(after).toEqual({ ...before, cube: "documents" });
    expect(result.trip.ready).toBe(true);
    expect(result.trip.items.filter((item) => item.id !== "chargers")).toEqual(
      trip.items.filter((item) => item.id !== "chargers"),
    );
  });

  it("rejects an unknown cube or item", () => {
    const trip = makeTrip();
    expect(moveItemToCube(trip, "chargers", "attic")).toEqual({
      ok: false,
      reason: "INVALID_CUBE",
      trip,
    });
    expect(moveItemToCube(trip, "nope", "tech")).toEqual({
      ok: false,
      reason: "ITEM_NOT_FOUND",
      trip,
    });
  });

  it("lists the cubes in use, in cube order", () => {
    expect(cubesInUse(makeTrip())).toEqual(["clothing", "toiletries", "tech"]);
  });
});

describe("Morning of", () => {
  it("is on for Toiletries by default and for the cube of every Pack last item", () => {
    const trip = makeTrip();
    expect(morningOfCubesFor(trip.items, trip.morningOfCubes)).toEqual(["toiletries", "tech"]);
  });

  it("moving a Pack last item moves the flag with it", () => {
    const moved = moveItemToCube(makeTrip(), "chargers", "documents");
    if (!moved.ok) throw new Error("move failed");
    expect(morningOfCubesFor(moved.trip.items, moved.trip.morningOfCubes)).toEqual([
      "toiletries",
      "documents",
    ]);
  });

  it("can be switched on and off per cube", () => {
    const on = setMorningOf(makeTrip(), "misc", true);
    expect(on.morningOfCubes).toEqual(["toiletries", "misc"]);
    const off = setMorningOf(on, "toiletries", false);
    expect(off.morningOfCubes).toEqual(["misc"]);
    expect(setMorningOf(off, "misc", true).morningOfCubes).toEqual(["misc"]);
  });
});

describe("remembering a laundry or per-night Staple", () => {
  it("stores the per-unit amount, not the halved or per-night trip total", () => {
    const trip = makeTrip(LAUNDRY);
    const edit = { name: "Tops", qty: 3, timing: "main" as const, scope: "remember" as const };
    const result = editItem(trip, STAPLES, "tops", edit);
    expect(result.ok && result.staples.find((s) => s.id === "tops")?.qty).toBe(1);
    const lens = editItem(trip, STAPLES, "lens", { ...edit, name: "Lens" });
    expect(lens.ok && lens.staples.find((s) => s.id === "lens")?.qty).toBe(1);
  });

  it("previews nothing for a laundry-halved Staple, and the per-day amount otherwise", () => {
    expect(rememberPreview(STAPLES, "tops", 4, 8)).toBeNull();
    expect(rememberPreview(STAPLES, "medicine", 16, 8)).toEqual({ kind: "per-day", perDay: 2 });
  });
});
