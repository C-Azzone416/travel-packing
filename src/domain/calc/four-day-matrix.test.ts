import { describe, expect, it } from "vitest";
import { calculateSuggestions, type CalcConfig } from "./suggestions";

// #202: a four-day trip (Nov 12 to Nov 15) across laundry, Nice outfits, occasions and nice-look reuse. The calculator's
// rule is: daily days = days - 2 (the return day is never counted, whatever the return-outfit switch says, TODO #25);
// each planned occasion takes one daily day away from the everyday looks; Nice outfits off means no occasions at all.
const FOUR_DAYS = { start: "2026-11-12", end: "2026-11-15", spare: false } as const;

function qtys(config: Partial<CalcConfig>): Record<string, number> {
  const result = calculateSuggestions({ ...FOUR_DAYS, ...config });
  expect(result.days).toBe(4);
  expect(result.dailyDays).toBe(2);
  return Object.fromEntries(result.items.map((item) => [item.id, item.qty]));
}

const NICE_IDS = ["nice-top", "nice-bottom", "nice-shoes", "nice-makeup", "nice-undergarments"];

describe("four days, Nice outfits off", () => {
  it.each([
    [false, 2, 1],
    [true, 1, 1],
  ])(
    "laundry %s: %i everyday tops, %i bottoms, and no nice-attire line at all",
    (laundry, tops, bottoms) => {
      for (const occasionCount of [0, 1, 2, "2", null]) {
        for (const reuseNice of [false, true]) {
          for (const returnOutfit of [false, true]) {
            const result = qtys({
              laundry,
              niceAttire: false,
              occasionCount,
              reuseNice,
              returnOutfit,
            });
            expect(result.tops).toBe(tops);
            expect(result.bottoms).toBe(bottoms);
            for (const id of NICE_IDS) expect(result[id]).toBeUndefined();
          }
        }
      }
    },
  );
});

describe("four days, Nice outfits on, no laundry", () => {
  // Each row: occasions, reuse -> everyday tops, everyday bottoms, nice tops (and bottoms).
  it.each([
    [1, false, 1, 1, 1],
    [1, true, 1, 1, 1],
    [2, false, undefined, undefined, 2],
    [2, true, undefined, undefined, 1],
  ])("%i occasion(s), reuse %s", (occasionCount, reuseNice, tops, bottoms, nice) => {
    const result = qtys({ laundry: false, niceAttire: true, occasionCount, reuseNice });
    expect(result.tops).toBe(tops);
    expect(result.bottoms).toBe(bottoms);
    expect(result["nice-top"]).toBe(nice);
    expect(result["nice-bottom"]).toBe(nice);
    expect(result["nice-shoes"]).toBe(1);
    expect(result["nice-undergarments"]).toBe(1);
  });

  it("is the list a Preview user reported: one occasion leaves ONE everyday top beside the nice-attire items", () => {
    expect(
      qtys({ laundry: false, niceAttire: true, occasionCount: 1, reuseNice: true }),
    ).toMatchObject({
      tops: 1,
      bottoms: 1,
      "nice-top": 1,
      "nice-bottom": 1,
      "nice-shoes": 1,
      "nice-undergarments": 1,
    });
  });
});

describe("four days, Nice outfits on, with laundry", () => {
  it("one occasion leaves one everyday look: one top, one bottom", () => {
    expect(
      qtys({ laundry: true, niceAttire: true, occasionCount: 1, reuseNice: false }),
    ).toMatchObject({
      tops: 1,
      bottoms: 1,
      "nice-top": 1,
    });
  });

  it("two occasions use every daily day, so no everyday tops or bottoms remain", () => {
    const result = qtys({ laundry: true, niceAttire: true, occasionCount: 2, reuseNice: false });
    expect(result.tops).toBeUndefined();
    expect(result.bottoms).toBeUndefined();
    expect(result["nice-top"]).toBe(2);
  });
});
