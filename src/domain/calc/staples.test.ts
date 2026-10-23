import { describe, expect, it } from "vitest";
import { canonicalItemId } from "../item-identity";
import { buildTripItems, supportsSmartQuantity, type Staple, type TripItem } from "./staples";
import type { CalcConfig } from "./suggestions";

const base: CalcConfig = {
  start: "2030-04-01",
  end: "2030-04-05",
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

const staple = (overrides: Partial<Staple> & Pick<Staple, "id" | "name">): Staple => ({
  qty: 1,
  cadence: "per trip",
  category: "Other essentials",
  packLast: false,
  ...overrides,
});
const byId = (items: TripItem[], id: string) => items.find((item) => item.id === id);

describe("personalized trip generation", () => {
  it("adds no personal essentials when the owner selected no Staples", () => {
    const { items } = buildTripItems(base, []);
    expect(items.map((item) => item.id)).toEqual([
      "tops",
      "bottoms",
      "underwear",
      "socks",
      "sleepwear",
      "return-top",
      "return-bottoms",
      "return-underwear",
      "return-socks",
    ]);
    expect(items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Laptop" }),
        expect.objectContaining({ name: "Makeup" }),
        expect.objectContaining({ name: "Everyday glasses" }),
      ]),
    );
    expect(items.every((item) => item.packed === 0)).toBe(true);
  });

  it("keeps the dedicated return outfit separate and optional", () => {
    expect(buildTripItems(base, []).items.filter((item) => item.section === "return")).toHaveLength(
      4,
    );
    expect(
      buildTripItems({ ...base, returnOutfit: false }, []).items.some(
        (item) => item.section === "return",
      ),
    ).toBe(false);
  });
});

describe("shared Staple quantity rules", () => {
  it.each([
    ["same day", "2030-04-01", "2030-04-01", false, false, true, 2],
    ["five days", "2030-04-01", "2030-04-05", false, false, true, 2],
    ["laundry", "2030-04-01", "2030-04-05", true, false, true, 2],
    ["nice and no return", "2030-04-01", "2030-04-05", true, true, false, 2],
  ])("fixed per trip: %s", (_label, start, end, laundry, niceAttire, returnOutfit, expected) => {
    const { items } = buildTripItems({ ...base, start, end, laundry, niceAttire, returnOutfit }, [
      staple({ id: "medicine", name: "Medicine", qty: 2 }),
    ]);
    expect(byId(items, "medicine")?.qty).toBe(expected);
  });

  it.each([
    ["same day", "2030-04-01", "2030-04-01", false, false, true, 2],
    ["five days", "2030-04-01", "2030-04-05", false, false, true, 10],
    ["laundry", "2030-04-01", "2030-04-05", true, false, true, 10],
    ["nice and no return", "2030-04-01", "2030-04-05", true, true, false, 10],
  ])(
    "per day uses every calendar day: %s",
    (_label, start, end, laundry, niceAttire, returnOutfit, expected) => {
      const { items } = buildTripItems({ ...base, start, end, laundry, niceAttire, returnOutfit }, [
        staple({ id: "medicine", name: "Medicine", qty: 2, cadence: "per day" }),
      ]);
      expect(byId(items, "medicine")?.qty).toBe(expected);
    },
  );

  it.each([
    ["same day", { start: "2030-04-01", end: "2030-04-01" }, 0],
    ["five days", {}, 3],
    ["laundry", { laundry: true }, 2],
    ["return off", { returnOutfit: false }, 4],
  ])("Smart tops use the canonical calculator: %s", (_label, change, expected) => {
    const { items } = buildTripItems({ ...base, ...change }, [
      staple({ id: "tops", name: "My shirts", cadence: "smart", category: "Clothing" }),
    ]);
    const tops = byId(items, "tops");
    if (expected === 0) expect(tops).toBeUndefined();
    else expect(tops).toMatchObject({ name: "My shirts", qty: expected, stapleCadence: "smart" });
  });

  it.each([
    [false, false, 0],
    [true, false, 3],
    [true, true, 1],
  ])("Smart nice top follows nice=%s reuse=%s", (niceAttire, reuseNice, expected) => {
    const { items } = buildTripItems({ ...base, niceAttire, occasionCount: 3, reuseNice }, [
      staple({
        id: "nice-top",
        name: "Dinner shirt",
        cadence: "smart",
        category: "Nice attire",
      }),
    ]);
    expect(byId(items, "nice-top")?.qty ?? 0).toBe(expected);
  });

  it("rejects Smart for an unsupported custom identity", () => {
    expect(() =>
      buildTripItems(base, [staple({ id: "custom-book", name: "Book", cadence: "smart" })]),
    ).toThrow(/not supported/);
    expect(supportsSmartQuantity("custom-book")).toBe(false);
  });
});

describe("semantic identity and precedence", () => {
  it("lets a renamed Staple replace the recommendation without summing", () => {
    const { items } = buildTripItems(base, [
      staple({ id: "underwear", name: "Base layers", qty: 2, category: "Clothing" }),
    ]);
    expect(items.filter((item) => canonicalItemId(item.id) === "underwear")).toEqual([
      expect.objectContaining({ name: "Base layers", qty: 2, stapleCadence: "per trip" }),
    ]);
  });

  it("deduplicates an alias without inspecting the display name", () => {
    const weather = {
      days: [
        {
          date: "2030-04-03",
          stopIndex: 0,
          source: "forecast" as const,
          highC: 28,
          lowC: 18,
          precipProbability: 0,
          precipMm: 0,
          snowCm: 0,
          uvIndexMax: 7,
          sunshineHours: 9,
        },
      ],
    };
    const { items } = buildTripItems(base, [staple({ id: "sunscreen", name: "My SPF" })], weather);
    expect(items.filter((item) => canonicalItemId(item.id) === "weather-sunscreen")).toEqual([
      expect.objectContaining({ id: "sunscreen", name: "My SPF", qty: 1 }),
    ]);
  });

  it("lets a clothing Staple replace weather-split rows from the same family", () => {
    const weather = {
      days: [
        {
          date: "2030-04-03",
          stopIndex: 0,
          source: "forecast" as const,
          highC: 28,
          lowC: 18,
          precipProbability: 0,
          precipMm: 0,
          snowCm: 0,
          uvIndexMax: 2,
          sunshineHours: 4,
        },
      ],
    };
    const { items } = buildTripItems(
      base,
      [staple({ id: "tops", name: "My shirts", cadence: "smart", category: "Clothing" })],
      weather,
    );
    expect(items.some((item) => item.id === "tops-short" || item.id === "tops-long")).toBe(false);
    expect(byId(items, "tops")).toMatchObject({ name: "My shirts", stapleCadence: "smart" });
  });

  it("does not let a colliding Staple replace the separate return outfit", () => {
    const { items } = buildTripItems(base, [
      staple({ id: "return-top", name: "Personal top", qty: 2, packLast: true }),
    ]);
    expect(items.filter((item) => item.id === "return-top")).toEqual([
      expect.objectContaining({ name: "Fresh top", qty: 1, section: "return" }),
    ]);
  });

  it("keeps placement and Pack last independent from category", () => {
    expect(
      byId(
        buildTripItems(base, [
          staple({
            id: "toothbrush",
            name: "Brush",
            category: "Tech",
            groupId: "toiletry-bag",
            packLast: true,
          }),
        ]).items,
        "toothbrush",
      ),
    ).toMatchObject({ category: "Tech", groupId: "toiletry-bag", section: "packlast" });
  });
});
