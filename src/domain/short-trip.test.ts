import { describe, expect, it } from "vitest";
import { calculateSuggestions as suggest, stapleContext, stapleQuantity } from "./calc";
import { recalculateSuggestions } from "./item-ops";
import {
  isDayTrip,
  laundryChangesQuantity,
  laundryControlVisible,
  laundryIdleReason,
} from "./short-trip";
import type { Trip, TripConfig, TripItem } from "./trip";

const CONFIG: TripConfig = {
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

/** A synthetic trip (fictional dates) built by the calculator, optionally with one Staple row marked ↻. */
function tripOf(start: string, end: string, config: TripConfig, flagged: boolean): Trip {
  const built = suggest({ ...config, start, end });
  const items = built.items
    .filter((entry) => !["tops", "bottoms"].includes(entry.id))
    .map((entry): TripItem => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      qty: entry.qty,
      packed: 0,
      section: "main",
    }));
  if (flagged) {
    const context = stapleContext(config, {
      days: built.days,
      nights: built.days - 1,
      dailyDays: built.dailyDays,
    });
    const staple = { id: "jacket", qty: 1, cadence: "per day" as const, laundryHalves: true };
    items.push({
      id: "jacket",
      name: "Jacket",
      category: "Clothing",
      qty: stapleQuantity(staple, context),
      packed: 0,
      section: "main",
      stapleQty: 1,
      stapleCadence: "per day",
      laundryHalves: true,
    });
  }
  return {
    id: "t",
    start,
    end,
    stops: [],
    config,
    days: built.days,
    dailyDays: built.dailyDays,
    items,
    suggestionMemory: {},
    suppressedSuggestions: {},
    weather: { status: "none", label: "", suggestion: "" },
  } as unknown as Trip;
}

describe("isDayTrip", () => {
  it("is true only when the trip begins and ends on the same date", () => {
    expect(isDayTrip({ start: "2030-03-14", end: "2030-03-14" })).toBe(true);
    expect(isDayTrip({ start: "2030-03-14", end: "2030-03-15" })).toBe(false);
    expect(isDayTrip({ start: "", end: "" })).toBe(false);
    expect(isDayTrip({} as Pick<Trip, "start" | "end">)).toBe(false);
  });
});

describe("the laundry control rule", () => {
  it("a day trip: laundry changes nothing, so the control is hidden", () => {
    const day = tripOf("2030-03-14", "2030-03-14", CONFIG, true);
    expect(laundryChangesQuantity(day)).toBe(false);
    expect(laundryControlVisible(day)).toBe(false);
  });

  it("one night with no marked Staple: nothing to halve, hidden", () => {
    expect(laundryControlVisible(tripOf("2030-03-14", "2030-03-15", CONFIG, false))).toBe(false);
  });

  it("one night with a marked Staple: 2 days halve to 1, so it is offered", () => {
    const night = tripOf("2030-03-14", "2030-03-15", CONFIG, true);
    expect(laundryChangesQuantity(night)).toBe(true);
    expect(laundryControlVisible(night)).toBe(true);
  });

  it("a long trip with the Smart clothing rows: offered", () => {
    const long = tripOf("2030-03-14", "2030-03-24", CONFIG, false);
    // The calculator's own tops are not in this fixture; a marked Staple carries the effect.
    expect(
      laundryControlVisible({
        ...long,
        items: tripOf("2030-03-14", "2030-03-24", CONFIG, true).items,
      }),
    ).toBe(true);
  });

  it("laundry already on keeps the control even when it no longer changes anything", () => {
    const on = { ...CONFIG, laundry: true };
    const day = tripOf("2030-03-14", "2030-03-14", on, true);
    expect(laundryChangesQuantity(day)).toBe(false);
    expect(laundryControlVisible(day)).toBe(true);
  });

  it("judges an edited config, not only the saved one (Edit trip)", () => {
    const night = tripOf("2030-03-14", "2030-03-15", CONFIG, true);
    expect(laundryControlVisible({ ...night, end: "2030-03-14" })).toBe(false);
  });
});

describe("only rows the trip really has count (#412)", () => {
  it("a fixed list of Towels gets no laundry control, even on a long trip: the calculator's own tops are not on it", () => {
    const long = tripOf("2030-03-14", "2030-03-24", CONFIG, false);
    const fixed = {
      ...long,
      items: [
        {
          id: "saved:l1:towel",
          name: "Towels",
          category: "Accessories",
          qty: 2,
          packed: 0,
          section: "main",
        },
      ] as TripItem[],
    };
    expect(laundryChangesQuantity(fixed)).toBe(false);
    expect(laundryControlVisible(fixed)).toBe(false);
  });
});

describe("laundry off and back on (#495)", () => {
  const ON = { ...CONFIG, laundry: true };
  const qtyOf = (trip: Trip, id: string) => trip.items.find((entry) => entry.id === id)?.qty;

  it("a multi-night trip with a marked Staple: off restores the quantity, the control stays, on halves it again", () => {
    const on = tripOf("2030-03-14", "2030-03-24", ON, true);
    const halved = qtyOf(on, "jacket")!;
    const off = recalculateSuggestions(on, { ...ON, laundry: false }, suggest);
    expect(qtyOf(off, "jacket")).toBeGreaterThan(halved);
    // Off must still offer the switch: turning it on WOULD change that row.
    expect(laundryChangesQuantity(off)).toBe(true);
    expect(laundryControlVisible(off)).toBe(true);
    expect(laundryIdleReason(off)).toBeNull();
    const back = recalculateSuggestions(off, { ...ON, laundry: true }, suggest);
    expect(qtyOf(back, "jacket")).toBe(halved);
  });

  it("a hand-edited quantity survives both flips", () => {
    const on = tripOf("2030-03-14", "2030-03-24", ON, true);
    const edited = {
      ...on,
      items: on.items.map((entry) =>
        entry.id === "jacket" ? { ...entry, qty: 9, userEdited: true } : entry,
      ),
    };
    const off = recalculateSuggestions(edited, { ...ON, laundry: false }, suggest);
    expect(qtyOf(off, "jacket")).toBe(9);
    expect(qtyOf(recalculateSuggestions(off, ON, suggest), "jacket")).toBe(9);
  });

  it("a multi-night list with no eligible row: unchanged totals are valid, and the reason is the list, not the length", () => {
    const long = tripOf("2030-03-14", "2030-03-24", ON, false);
    // A fixed list (no Everyday tops/bottoms, no marked Staple): flipping laundry moves none of its rows.
    const off = { ...long, config: { ...ON, laundry: false } };
    const flipped = recalculateSuggestions(off, ON, suggest);
    for (const entry of long.items) expect(qtyOf(flipped, entry.id)).toBe(entry.qty);
    expect(laundryChangesQuantity(off)).toBe(false);
    expect(laundryControlVisible(off)).toBe(false);
    expect(laundryIdleReason(off)).toBe("no-items");
  });

  it("a weather-split list is left alone by laundry, so it is idle too", () => {
    const long = tripOf("2030-03-14", "2030-03-24", CONFIG, false);
    const split = {
      ...long,
      items: [
        {
          id: "tops-short",
          name: "Short-sleeve tops",
          category: "Clothing",
          qty: 6,
          packed: 0,
          section: "main",
        },
      ] as TripItem[],
    };
    expect(laundryIdleReason(split)).toBe("no-items");
  });

  it("a day trip is reported as a day trip, and a changing trip has no reason", () => {
    expect(laundryIdleReason(tripOf("2030-03-14", "2030-03-14", CONFIG, true))).toBe("day-trip");
    expect(laundryIdleReason(tripOf("2030-03-14", "2030-03-24", CONFIG, true))).toBeNull();
  });
});
