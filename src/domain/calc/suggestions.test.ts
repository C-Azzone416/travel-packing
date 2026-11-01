import { describe, expect, it } from "vitest";
import { calculateSuggestions, dailyDaysFor, type CalcConfig } from "./suggestions";

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
    [2, { tops: 1, bottoms: 1, underwear: 1, socks: 1, sleepwear: 1 }],
    [3, { tops: 2, bottoms: 1, underwear: 2, socks: 2, sleepwear: 1 }],
    [5, { tops: 4, bottoms: 2, underwear: 4, socks: 4, sleepwear: 1 }],
    [10, { tops: 9, bottoms: 5, underwear: 9, socks: 9, sleepwear: 1 }],
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
      underwear: 4,
      socks: 4,
      sleepwear: 1,
    });
  });

  it("spare adds one underwear and one sock", () => {
    expect(qtys({ spare: true })).toEqual({
      tops: 4,
      bottoms: 2,
      underwear: 5,
      socks: 5,
      sleepwear: 1,
    });
  });

  it("8 days with laundry off and on", () => {
    expect(qtys(range(8))).toMatchObject({ tops: 7, bottoms: 4 });
    expect(qtys({ ...range(8), laundry: true })).toMatchObject({ tops: 4, bottoms: 2 });
  });

  it.each([
    [1, 1],
    [2, 2],
  ])(
    "spare packs one more underwear and socks than the everyday days on a %i-day trip",
    (days, expected) => {
      const result = qtys({ ...range(days), spare: true });
      expect(result.underwear).toBe(expected);
      expect(result.socks).toBe(expected);
    },
  );

  it("laundry on a day trip yields no tops or bottoms", () => {
    expect(qtys({ ...range(1), laundry: true })).toEqual({});
  });

  it("laundry on an overnight trip still packs one top and one bottom", () => {
    expect(qtys({ ...range(2), laundry: true })).toMatchObject({ tops: 1, bottoms: 1 });
  });
});

describe("nice attire", () => {
  const ten = range(10);
  // Nice occasions are IN ADDITION to everyday outfits (#205): the everyday counts never move with the occasion count. A 10-day
  // trip with the return outfit on has 9 everyday days: 9 tops, 5 bottoms, whatever the occasions.
  const occasions = [1, 2, 3, 4, 5, 6, 7, 8] as const;

  it.each(occasions)("occasionCount %i on a 10-day trip without reuse", (n) => {
    const result = qtys({ ...ten, niceAttire: true, occasionCount: n });
    expect(result.tops).toBe(9);
    expect(result.bottoms).toBe(5);
    expect(result["nice-top"]).toBe(n);
    expect(result["nice-bottom"]).toBe(n);
    expect(result["nice-shoes"]).toBe(1);
    expect(result["nice-makeup"]).toBeUndefined();
    expect(result["nice-undergarments"]).toBeUndefined();
  });

  it.each(occasions)(
    "occasionCount %i with reuse collapses to one look and keeps everyday counts",
    (n) => {
      const result = qtys({ ...ten, niceAttire: true, occasionCount: n, reuseNice: true });
      expect(result["nice-top"]).toBe(1);
      expect(result["nice-bottom"]).toBe(1);
      expect(result.tops).toBe(9);
      expect(result.bottoms).toBe(5);
    },
  );

  it("occasions never take everyday tops and bottoms away, however many there are", () => {
    // A 5-day trip has 4 everyday days. Five occasions used to leave none; now they sit on top.
    const result = qtys({ niceAttire: true, occasionCount: 5 });
    expect(result.tops).toBe(4);
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

  it("offers only the generic dress-shoes companion, with no personal assumptions", () => {
    const { items } = calculateSuggestions({ ...off, niceAttire: true });
    const optional = items.filter((item) => item.optional).map((item) => [item.id, item.category]);
    expect(optional).toEqual([["nice-shoes", "Nice attire"]]);
    expect(items.some((item) => ["nice-makeup", "nice-undergarments"].includes(item.id))).toBe(
      false,
    );
    expect(items.find((item) => item.id === "tops")?.category).toBe("Clothing");
  });
});

describe("the arrival day and the return outfit (#25, #205, #295)", () => {
  const four = { ...off, start: "2026-11-01", end: "2026-11-04" };

  it("the travel outfit is worn, not packed: every trip day needs an everyday outfit, less the return day when covered", () => {
    expect(calculateSuggestions({ ...off, returnOutfit: false }).dailyDays).toBe(5);
    expect(calculateSuggestions({ ...off, returnOutfit: true }).dailyDays).toBe(4);
    // Left out, the return outfit is on.
    expect(calculateSuggestions(off).dailyDays).toBe(4);
  });

  // The worked examples on #295: 4 days, laundry off. Arrival day 1 now gets an everyday outfit.
  it("example 1: Nice off, return outfit off -> 4 everyday tops (days 1 to 4)", () => {
    const result = qtys({ ...four, returnOutfit: false });
    expect(result.tops).toBe(4);
    expect(result.underwear).toBe(4);
    expect(result.socks).toBe(4);
  });

  it("example 2: Nice off, return outfit on -> 3 everyday tops (plus the return outfit, which staples add)", () => {
    const result = qtys({ ...four, returnOutfit: true });
    expect(result.tops).toBe(3);
    expect(result.underwear).toBe(3);
  });

  it("example 3: Nice on, 1 occasion, return outfit off -> 4 everyday tops plus 1 nice-attire set (additive)", () => {
    const result = qtys({ ...four, returnOutfit: false, niceAttire: true, occasionCount: 1 });
    expect(result.tops).toBe(4);
    expect(result["nice-top"]).toBe(1);
    expect(result["nice-bottom"]).toBe(1);
  });

  it("the same with laundry on: tops are halved and bottoms quartered from the everyday days", () => {
    expect(qtys({ ...four, returnOutfit: false, laundry: true })).toMatchObject({
      tops: 2, // ceil(4 / 2)
      bottoms: 1, // ceil(4 / 4)
      underwear: 4,
    });
    expect(qtys({ ...four, returnOutfit: true, laundry: true })).toMatchObject({
      tops: 2, // ceil(3 / 2)
      bottoms: 1,
      underwear: 3,
    });
  });

  // Table-driven from the worked examples on #295: [days, return outfit, laundry, dailyDays, tops, bottoms].
  it.each([
    [2, true, false, 1, 1, 1],
    [2, false, false, 2, 2, 1],
    [3, true, false, 2, 2, 1],
    [3, false, false, 3, 3, 2],
    [7, true, true, 6, 3, 2],
    [7, true, false, 6, 6, 3],
    [7, false, false, 7, 7, 4],
  ])(
    "%i days, return outfit %s, laundry %s: %i everyday days -> %i tops, %i bottoms",
    (days, returnOutfit, laundry, dailyDays, tops, bottoms) => {
      const config = { ...range(days), returnOutfit, laundry };
      const result = qtys(config);
      expect(calculateSuggestions({ ...off, ...config }).dailyDays).toBe(dailyDays);
      expect(result).toMatchObject({ tops, bottoms, underwear: dailyDays, socks: dailyDays });
    },
  );

  it("a week with 2 dinners: nice outfits sit on top of the 6 everyday; reuse collapses them to one", () => {
    const dinners = { ...range(7), returnOutfit: true, niceAttire: true, occasionCount: 2 };
    expect(qtys(dinners)).toMatchObject({ tops: 6, "nice-top": 2, "nice-bottom": 2 });
    expect(qtys({ ...dinners, reuseNice: true })).toMatchObject({
      tops: 6,
      "nice-top": 1,
      "nice-bottom": 1,
    });
  });

  it("a day trip packs no tops, bottoms, underwear or socks, with the return outfit on or off", () => {
    for (const returnOutfit of [true, false]) {
      expect(qtys({ ...range(1), returnOutfit })).toEqual({});
    }
  });

  it("a longer trip: 10 days -> 10 everyday days with the return outfit off, 9 with it on", () => {
    const ten = range(10);
    expect(qtys({ ...ten, returnOutfit: false })).toMatchObject({
      tops: 10,
      bottoms: 5,
      underwear: 10,
    });
    expect(qtys({ ...ten, returnOutfit: true })).toMatchObject({
      tops: 9,
      bottoms: 5,
      underwear: 9,
    });
    expect(qtys({ ...ten, returnOutfit: false, laundry: true })).toMatchObject({
      tops: 5,
      bottoms: 3,
    });
  });

  it("spare adds one underwear and one sock on top of the everyday days", () => {
    const result = qtys({ ...four, returnOutfit: false, spare: true });
    expect(result.underwear).toBe(5);
    expect(result.socks).toBe(5);
    expect(result.tops).toBe(4);
  });

  it("a day trip has no everyday days either way; an overnight has one or two", () => {
    for (const returnOutfit of [true, false]) {
      expect(calculateSuggestions({ ...off, ...range(1), returnOutfit }).dailyDays).toBe(0);
    }
    expect(calculateSuggestions({ ...off, ...range(2), returnOutfit: true }).dailyDays).toBe(1);
    expect(calculateSuggestions({ ...off, ...range(2), returnOutfit: false }).dailyDays).toBe(2);
  });

  it("dailyDaysFor is the single formula behind it", () => {
    expect(dailyDaysFor(5, true)).toBe(4);
    expect(dailyDaysFor(5, false)).toBe(5);
    expect(dailyDaysFor(1, false)).toBe(0);
    expect(dailyDaysFor(0, false)).toBe(0);
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
