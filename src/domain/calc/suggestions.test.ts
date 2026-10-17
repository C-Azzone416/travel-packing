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
  const expected = [
    // occasionCount, tops, bottoms (undefined = omitted)
    [1, 7, 4],
    [2, 6, 3],
    [3, 5, 3],
    [4, 4, 2],
    [5, 3, 2],
    [6, 2, 1],
    [7, 1, 1],
    [8, 0, undefined],
  ] as const;

  it.each(expected)("occasionCount %i on a 10-day trip without reuse", (n, tops, bottoms) => {
    const result = qtys({ ...ten, niceAttire: true, occasionCount: n });
    expect(result.tops).toBe(tops || undefined);
    expect(result.bottoms).toBe(bottoms);
    expect(result["nice-top"]).toBe(n);
    expect(result["nice-bottom"]).toBe(n);
    expect(result["nice-shoes"]).toBe(1);
    expect(result["nice-makeup"]).toBe(1);
    expect(result["nice-undergarments"]).toBe(1);
  });

  it.each(expected)(
    "occasionCount %i with reuse collapses to one look but keeps everyday counts",
    (n, tops, bottoms) => {
      const result = qtys({ ...ten, niceAttire: true, occasionCount: n, reuseNice: true });
      expect(result["nice-top"]).toBe(1);
      expect(result["nice-bottom"]).toBe(1);
      expect(result.tops).toBe(tops || undefined);
      expect(result.bottoms).toBe(bottoms);
    },
  );

  it("drops tops and bottoms when occasions outnumber the everyday days", () => {
    const result = qtys({ niceAttire: true, occasionCount: 5 });
    expect(result.tops).toBeUndefined();
    expect(result.bottoms).toBeUndefined();
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
    expect(items.find((item) => item.id === "tops")?.category).toBe("Clothes");
  });
});

describe("return outfit switch point (TODO #25)", () => {
  it("currently excludes the return day even with the return outfit off", () => {
    expect(RETURN_OFF_POLICY).toBe("exclude-return-day");
    expect(calculateSuggestions({ ...off, returnOutfit: false }).dailyDays).toBe(3);
    expect(calculateSuggestions({ ...off, returnOutfit: true }).dailyDays).toBe(3);
    expect(calculateSuggestions(off).dailyDays).toBe(3);
  });

  it("can add the return day back for the alternative policy", () => {
    expect(dailyDaysFor(5, true, "add-return-day-back")).toBe(3);
    expect(dailyDaysFor(5, false, "add-return-day-back")).toBe(4);
    expect(dailyDaysFor(5, false, "exclude-return-day")).toBe(3);
    expect(dailyDaysFor(1, false, "add-return-day-back")).toBe(0);
    expect(dailyDaysFor(0, false, "add-return-day-back")).toBe(0);
  });
});
