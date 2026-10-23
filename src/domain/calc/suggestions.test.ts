import { describe, expect, it } from "vitest";
import {
  calculateSuggestions,
  dailyDaysFor,
  RETURN_OFF_POLICY,
  type CalcConfig,
} from "./suggestions";

const off: CalcConfig = {
  start: "2026-11-12",
  end: "2026-11-16",
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
};

function qtys(config: Partial<CalcConfig>): Record<string, number> {
  const result = calculateSuggestions({ ...off, ...config });
  return Object.fromEntries(result.items.map((item) => [item.id, item.qty]));
}

const range = (days: number): Pick<CalcConfig, "start" | "end"> => ({
  start: "2026-11-01",
  end: `2026-11-${String(days).padStart(2, "0")}`,
});

describe("trip length with every option off", () => {
  it.each([
    [1, {}],
    [2, { sleepwear: 1 }],
    [3, { tops: 1, bottoms: 1, underwear: 1, socks: 1, sleepwear: 1 }],
    [5, { tops: 3, bottoms: 2, underwear: 3, socks: 3, sleepwear: 1 }],
    [10, { tops: 8, bottoms: 4, underwear: 8, socks: 8, sleepwear: 1 }],
  ])("%i days", (days, expected) => {
    expect(qtys(range(days))).toEqual(expected);
  });

  it("returns no items and zero days for reversed dates", () => {
    expect(calculateSuggestions({ ...off, start: "2026-11-16", end: "2026-11-12" })).toEqual({
      days: 0,
      dailyDays: 0,
      items: [],
    });
  });
});

describe("laundry and spare", () => {
  it("laundry halves tops and quarters bottoms but never touches underwear or socks", () => {
    expect(qtys({ laundry: true })).toEqual({
      tops: 2,
      bottoms: 1,
      underwear: 3,
      socks: 3,
      sleepwear: 1,
    });
  });

  it("spare adds one underwear and one sock", () => {
    expect(qtys({ spare: true })).toEqual({
      tops: 3,
      bottoms: 2,
      underwear: 4,
      socks: 4,
      sleepwear: 1,
    });
  });

  it("8 days with laundry off and on", () => {
    expect(qtys(range(8))).toMatchObject({ tops: 6, bottoms: 3 });
    expect(qtys({ ...range(8), laundry: true })).toMatchObject({ tops: 3, bottoms: 2 });
  });

  it.each([1, 2])("spare still packs one underwear and socks on a %i-day trip", (days) => {
    const result = qtys({ ...range(days), spare: true });
    expect(result.underwear).toBe(1);
    expect(result.socks).toBe(1);
  });

  it("laundry with no everyday looks yields no tops or bottoms", () => {
    expect(qtys({ ...range(2), laundry: true })).toEqual({ sleepwear: 1 });
  });
});

describe("nice attire", () => {
  const ten = range(10);
  // Nice occasions are IN ADDITION to everyday outfits (#205): the everyday counts never move with the occasion count. A 10-day
  // trip with the return outfit on has 8 everyday days: 8 tops, 4 bottoms, whatever the occasions.
  const occasions = [1, 2, 3, 4, 5, 6, 7, 8] as const;

  it.each(occasions)("occasionCount %i on a 10-day trip without reuse", (n) => {
    const result = qtys({ ...ten, niceAttire: true, occasionCount: n });
    expect(result.tops).toBe(8);
    expect(result.bottoms).toBe(4);
    expect(result["nice-top"]).toBe(n);
    expect(result["nice-bottom"]).toBe(n);
    expect(result["nice-shoes"]).toBe(1);
    expect(result["nice-makeup"]).toBe(1);
    expect(result["nice-undergarments"]).toBe(1);
  });

  it.each(occasions)(
    "occasionCount %i with reuse collapses to one look and keeps everyday counts",
    (n) => {
      const result = qtys({ ...ten, niceAttire: true, occasionCount: n, reuseNice: true });
      expect(result["nice-top"]).toBe(1);
      expect(result["nice-bottom"]).toBe(1);
      expect(result.tops).toBe(8);
      expect(result.bottoms).toBe(4);
    },
  );

  it("occasions never take everyday tops and bottoms away, however many there are", () => {
    // A 5-day trip has 3 everyday days. Five occasions used to leave none; now they sit on top.
    const result = qtys({ niceAttire: true, occasionCount: 5 });
    expect(result.tops).toBe(3);
    expect(result.bottoms).toBe(2);
    expect(result["nice-top"]).toBe(5);
    expect(qtys({ niceAttire: true, occasionCount: 5, reuseNice: true })["nice-top"]).toBe(1);
  });

  it.each([0, Number.NaN, "", undefined, null, "abc"])(
    "treats occasionCount %j as one occasion",
    (occasionCount) => {
      expect(qtys({ niceAttire: true, occasionCount })["nice-top"]).toBe(1);
    },
  );

  it("reads a numeric string occasionCount", () => {
    expect(qtys({ niceAttire: true, occasionCount: "3" })["nice-top"]).toBe(3);
  });

  it("ignores occasionCount when niceAttire is off", () => {
    const ids = Object.keys(qtys({ occasionCount: 4 }));
    expect(ids.some((id) => id.startsWith("nice-"))).toBe(false);
  });

  it("marks exactly the three companions optional, with the prototype categories", () => {
    const { items } = calculateSuggestions({ ...off, niceAttire: true });
    const optional = items.filter((item) => item.optional).map((item) => [item.id, item.category]);
    expect(optional).toEqual([
      ["nice-shoes", "Nice attire"],
      ["nice-makeup", "Bathroom"],
      ["nice-undergarments", "Nice attire"],
    ]);
    expect(items.find((item) => item.id === "tops")?.category).toBe("Clothing");
  });
});

describe("the return outfit and the checkout day (#25, #205)", () => {
  const four = { ...off, start: "2026-11-01", end: "2026-11-04" };

  it("is decided: with the return outfit off the checkout day gets an everyday look", () => {
    expect(RETURN_OFF_POLICY).toBe("add-return-day-back");
    expect(calculateSuggestions({ ...off, returnOutfit: false }).dailyDays).toBe(4);
    expect(calculateSuggestions({ ...off, returnOutfit: true }).dailyDays).toBe(3);
    // Left out, the return outfit is on.
    expect(calculateSuggestions(off).dailyDays).toBe(3);
  });

  // Caroline's worked examples: 4 days, laundry off, the outbound outfit worn on day 1.
  it("example 1: Nice off, return outfit off -> 3 everyday tops (days 2, 3 and checkout day 4)", () => {
    const result = qtys({ ...four, returnOutfit: false });
    expect(result.tops).toBe(3);
    expect(result.underwear).toBe(3);
    expect(result.socks).toBe(3);
  });

  it("example 2: Nice off, return outfit on -> 2 everyday tops (plus the return outfit, which staples add)", () => {
    const result = qtys({ ...four, returnOutfit: true });
    expect(result.tops).toBe(2);
    expect(result.underwear).toBe(2);
  });

  it("example 3: Nice on, 1 occasion, return outfit off -> 3 everyday tops plus 1 nice-attire set (additive)", () => {
    const result = qtys({ ...four, returnOutfit: false, niceAttire: true, occasionCount: 1 });
    expect(result.tops).toBe(3);
    expect(result["nice-top"]).toBe(1);
    expect(result["nice-bottom"]).toBe(1);
  });

  it("the same with laundry on: tops are halved and bottoms quartered from the everyday days", () => {
    expect(qtys({ ...four, returnOutfit: false, laundry: true })).toMatchObject({
      tops: 2, // ceil(3 / 2)
      bottoms: 1, // ceil(3 / 4)
      underwear: 3,
    });
    expect(qtys({ ...four, returnOutfit: true, laundry: true })).toMatchObject({
      tops: 1, // ceil(2 / 2)
      bottoms: 1,
      underwear: 2,
    });
  });

  it("a longer trip: 10 days -> 9 everyday days with the return outfit off, 8 with it on", () => {
    const ten = range(10);
    expect(qtys({ ...ten, returnOutfit: false })).toMatchObject({
      tops: 9,
      bottoms: 5,
      underwear: 9,
    });
    expect(qtys({ ...ten, returnOutfit: true })).toMatchObject({
      tops: 8,
      bottoms: 4,
      underwear: 8,
    });
    expect(qtys({ ...ten, returnOutfit: false, laundry: true })).toMatchObject({
      tops: 5,
      bottoms: 3,
    });
  });

  it("spare adds one underwear and one sock on top of the checkout day's", () => {
    const result = qtys({ ...four, returnOutfit: false, spare: true });
    expect(result.underwear).toBe(4);
    expect(result.socks).toBe(4);
  });

  it("a one- or two-day trip has no everyday days either way", () => {
    for (const days of [1, 2]) {
      expect(calculateSuggestions({ ...off, ...range(days), returnOutfit: true }).dailyDays).toBe(
        0,
      );
    }
    expect(calculateSuggestions({ ...off, ...range(1), returnOutfit: false }).dailyDays).toBe(0);
    expect(calculateSuggestions({ ...off, ...range(2), returnOutfit: false }).dailyDays).toBe(1);
  });

  it("dailyDaysFor follows the policy, with the two policies still available to callers", () => {
    expect(dailyDaysFor(5, true, "add-return-day-back")).toBe(3);
    expect(dailyDaysFor(5, false, "add-return-day-back")).toBe(4);
    expect(dailyDaysFor(5, false, "exclude-return-day")).toBe(3);
    expect(dailyDaysFor(1, false, "add-return-day-back")).toBe(0);
    expect(dailyDaysFor(0, false, "add-return-day-back")).toBe(0);
  });

  it('uses the single semantic category "Clothing" for every everyday clothing row (never "Clothes")', () => {
    const { items } = calculateSuggestions({ ...off, laundry: true, spare: true });
    const everyday = items.filter((item) =>
      ["tops", "bottoms", "underwear", "socks", "sleepwear"].includes(item.id),
    );
    expect(everyday.map((item) => item.id)).toEqual([
      "tops",
      "bottoms",
      "underwear",
      "socks",
      "sleepwear",
    ]);
    expect(everyday.every((item) => item.category === "Clothing")).toBe(true);
    expect(items.some((item) => item.category === "Clothes")).toBe(false);
  });
});
