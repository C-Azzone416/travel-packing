import { describe, expect, it } from "vitest";
import { nightsFor } from "./daily-days";
import {
  buildTripItems,
  stapleContext,
  stapleQuantity,
  type Staple,
  type StapleQuantityContext,
} from "./staples";
import { calculateSuggestions, type CalcConfig } from "./suggestions";

const ctx = (over: Partial<StapleQuantityContext> = {}): StapleQuantityContext => ({
  days: 5,
  nights: 4,
  dailyDays: 4,
  laundry: false,
  spare: false,
  ...over,
});
const q = (staple: Partial<Staple> & Pick<Staple, "id">, context = ctx()) =>
  stapleQuantity({ qty: 1, cadence: "per trip", ...staple }, context);

describe("nights", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [5, 4],
  ])("%i days -> %i nights", (days, nights) => {
    expect(nightsFor(days)).toBe(nights);
  });

  it("calculateSuggestions reports nights", () => {
    expect(calculateSuggestions({ start: "2030-04-01", end: "2030-04-05" }).nights).toBe(4);
    expect(calculateSuggestions({ start: "2030-04-01", end: "2030-04-01" }).nights).toBe(0);
  });
});

describe("stapleQuantity cadences", () => {
  it("per trip is the quantity as is", () => {
    expect(q({ id: "chargers", qty: 3 })).toBe(3);
  });

  it("per night multiplies by nights, not days", () => {
    expect(q({ id: "contact-lenses", qty: 2, cadence: "per night" })).toBe(8);
    expect(q({ id: "contact-lenses", qty: 2, cadence: "per night" }, ctx({ nights: 0 }))).toBe(0);
  });

  it("per day multiplies by every calendar day for ordinary items", () => {
    expect(q({ id: "medicine", qty: 2, cadence: "per day" })).toBe(10);
  });

  it("per day uses the everyday-outfit count for clothing families (#295)", () => {
    for (const id of ["tops", "bottoms", "underwear", "socks"]) {
      expect(q({ id, qty: 2, cadence: "per day" }), id).toBe(8);
    }
    expect(q({ id: "tops", cadence: "per day" }, ctx({ dailyDays: 0 }))).toBe(0);
  });

  it("the spare adds one to per-day underwear and socks only", () => {
    const spare = ctx({ spare: true });
    expect(q({ id: "underwear", cadence: "per day" }, spare)).toBe(5);
    expect(q({ id: "socks", qty: 2, cadence: "per day" }, spare)).toBe(9);
    expect(q({ id: "tops", cadence: "per day" }, spare)).toBe(4);
    expect(q({ id: "underwear", cadence: "per trip" }, spare)).toBe(1);
  });
});

describe("laundry halving rounds up", () => {
  const half = (qty: number, laundry = true, id = "medicine") =>
    q({ id, qty, cadence: "per trip", laundryHalves: true }, ctx({ laundry }));

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [10, 5],
    [11, 6],
  ])("%i -> %i with laundry", (qty, expected) => {
    expect(half(qty)).toBe(expected);
  });

  it("does nothing without laundry on the trip", () => {
    expect(half(5, false)).toBe(5);
    expect(half(11, false)).toBe(11);
  });

  it("does nothing without the flag", () => {
    expect(q({ id: "medicine", qty: 5, cadence: "per trip" }, ctx({ laundry: true }))).toBe(5);
  });

  it("halves per-day and per-night totals", () => {
    const laundry = ctx({ laundry: true });
    expect(q({ id: "tops", cadence: "per day", laundryHalves: true }, laundry)).toBe(2);
    expect(q({ id: "medicine", cadence: "per day", laundryHalves: true }, laundry)).toBe(3);
    expect(
      q(
        { id: "lens", cadence: "per night", laundryHalves: true },
        ctx({ days: 12, nights: 11, laundry: true }),
      ),
    ).toBe(6);
  });

  it("underwear and socks never halve, even if the flag is set", () => {
    const laundry = ctx({ laundry: true, spare: true });
    expect(q({ id: "underwear", cadence: "per day", laundryHalves: true }, laundry)).toBe(5);
    expect(q({ id: "socks", cadence: "per day", laundryHalves: true }, laundry)).toBe(5);
    expect(q({ id: "socks", qty: 9, cadence: "per trip", laundryHalves: true }, laundry)).toBe(9);
  });
});

describe("buildTripItems with the new Staple model", () => {
  const config: CalcConfig = {
    start: "2030-04-01",
    end: "2030-04-05",
    laundry: true,
    spare: true,
    returnOutfit: true,
  };
  const staple = (over: Partial<Staple> & Pick<Staple, "id" | "name">): Staple => ({
    qty: 1,
    cadence: "per trip",
    category: "Clothing",
    packLast: false,
    ...over,
  });

  it("applies cadence, laundry and spare, and snapshots the rule on each row", () => {
    const { items, days } = buildTripItems(config, [
      staple({ id: "tops", name: "Tops", cadence: "per day", laundryHalves: true }),
      staple({ id: "underwear", name: "Underwear", cadence: "per day" }),
      staple({ id: "lens", name: "Lens", cadence: "per night", category: "Bathroom", qty: 3 }),
    ]);
    expect(days).toBe(5);
    const row = (id: string) => items.find((item) => item.id === id && item.section !== "return");
    expect(row("tops")).toMatchObject({
      qty: 2,
      stapleCadence: "per day",
      stapleQty: 1,
      laundryHalves: true,
      cube: "clothing",
    });
    expect(row("underwear")).toMatchObject({
      qty: 5,
      stapleCadence: "per day",
      stapleQty: 1,
      laundryHalves: false,
    });
    expect(row("lens")).toMatchObject({ qty: 12, stapleCadence: "per night", cube: "toiletries" });
  });

  it("never snapshots the laundry flag on underwear, even if a Staple carries it", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "socks", name: "Socks", cadence: "per day", laundryHalves: true }),
    ]);
    expect(items.find((item) => item.id === "socks" && item.section !== "return")).toMatchObject({
      qty: 5,
      laundryHalves: false,
    });
  });

  it("keeps Smart staples on the calculator and snapshots no per-unit quantity", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "tops", name: "Tops", cadence: "smart" }),
    ]);
    const tops = items.find((item) => item.id === "tops")!;
    expect(tops.stapleCadence).toBe("smart");
    expect(tops.stapleQty).toBeUndefined();
    expect(tops.laundryHalves).toBeUndefined();
    expect(tops.qty).toBe(calculateSuggestions(config).items.find((e) => e.id === "tops")!.qty);
  });

  it("gives Staples the cube they were given, else the one their category implies", () => {
    const { items } = buildTripItems(config, [
      staple({ id: "passport", name: "Passport", category: "Other essentials" }),
      staple({ id: "pillow", name: "Pillow", category: "Other essentials", cube: "tech" }),
    ]);
    expect(items.find((item) => item.id === "passport")?.cube).toBe("documents");
    expect(items.find((item) => item.id === "pillow")?.cube).toBe("tech");
  });

  it("gives calculated rows their cubes", () => {
    const { items } = buildTripItems({ ...config, niceAttire: true }, []);
    expect(new Set(items.map((item) => item.cube))).toEqual(new Set(["clothing"]));
  });

  it("stapleContext reads laundry and spare from the config", () => {
    expect(stapleContext({}, { days: 1, nights: 0, dailyDays: 0 })).toEqual({
      days: 1,
      nights: 0,
      dailyDays: 0,
      laundry: false,
      spare: false,
    });
  });
});
