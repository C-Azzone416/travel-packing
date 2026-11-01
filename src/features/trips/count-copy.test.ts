import { describe, expect, it } from "vitest";
import { dailyDaysFor } from "@/domain/calc/daily-days";
import {
  countCallout,
  countedWithEarlierRule,
  countEquation,
  countTiles,
  everydayHeading,
  STALE_COUNT_NOTE,
  tripMathLine,
} from "./count-copy";

const n = dailyDaysFor;
const WORN = "Your travel outfit is worn, not packed.";
const DAY_TRIP =
  "A day trip: you wear one outfit all day, so there are no everyday clothes to pack.";

// The worked-example table from the design spec on #295 (verbatim strings).
const CASES = [
  {
    name: "day trip",
    days: 1,
    on: false,
    heading: "No everyday clothes to pack",
    tiles: [1, 0, 0],
    line: DAY_TRIP,
  },
  {
    name: "overnight, return on",
    days: 2,
    on: true,
    heading: "1 day of everyday clothes",
    tiles: [2, 1, 1],
    line: `2 days away − 1 for home = 1 day of everyday clothes. ${WORN}`,
  },
  {
    name: "overnight, return off",
    days: 2,
    on: false,
    heading: "2 days of everyday clothes",
    tiles: [2, 2, 0],
    line: `2 days away, none held back for home = 2 days of everyday clothes. ${WORN}`,
  },
  {
    name: "weekend, return on",
    days: 3,
    on: true,
    heading: "2 days of everyday clothes",
    tiles: [3, 2, 1],
    line: `3 days away − 1 for home = 2 days of everyday clothes. ${WORN}`,
  },
  {
    name: "weekend, return off",
    days: 3,
    on: false,
    heading: "3 days of everyday clothes",
    tiles: [3, 3, 0],
    line: `3 days away, none held back for home = 3 days of everyday clothes. ${WORN}`,
  },
  {
    name: "week, return on",
    days: 7,
    on: true,
    heading: "6 days of everyday clothes",
    tiles: [7, 6, 1],
    line: `7 days away − 1 for home = 6 days of everyday clothes. ${WORN}`,
  },
  {
    name: "week, return off",
    days: 7,
    on: false,
    heading: "7 days of everyday clothes",
    tiles: [7, 7, 0],
    line: `7 days away, none held back for home = 7 days of everyday clothes. ${WORN}`,
  },
];

describe("the spec table, verbatim", () => {
  it.each(CASES)("$name", ({ days, on, heading, tiles, line }) => {
    const everyday = n(days, on);
    expect(everydayHeading(everyday)).toBe(heading);
    expect(countTiles(days, everyday, on).map((tile) => tile.value)).toEqual(tiles);
    expect(tripMathLine(days, everyday, on)).toBe(line);
  });
});

describe("everydayHeading", () => {
  it("says days of everyday clothes, singular for one, and the zero case in words", () => {
    expect(everydayHeading(5)).toBe("5 days of everyday clothes");
    expect(everydayHeading(1)).toBe("1 day of everyday clothes");
    expect(everydayHeading(0)).toBe("No everyday clothes to pack");
  });
});

describe("the tiles", () => {
  it("are days away, everyday outfits, and set aside for the trip home", () => {
    expect(countTiles(7, 6, true).map((tile) => tile.label)).toEqual([
      "Days away",
      "Everyday outfits",
      "Set aside for the trip home",
    ]);
  });

  it("add up: days away = everyday + set aside, for every trip of 2+ days", () => {
    for (const on of [true, false]) {
      for (let days = 2; days <= 14; days++) {
        const [away, everyday, home] = countTiles(days, n(days, on), on).map((tile) => tile.value);
        expect(away).toBe(everyday + home);
      }
    }
  });

  it("a day trip sets nothing aside, even with the return outfit on", () => {
    expect(countTiles(1, 0, true).map((tile) => tile.value)).toEqual([1, 0, 0]);
  });
});

describe("the callout", () => {
  it("return outfit ON", () => {
    expect(countCallout(7, n(7, true), true)).toBe(
      "Your travel outfit is what you wear on the way there. It's worn, not packed. The trip home gets its own set, packed separately. 7 days away − 1 for home = 6 days of everyday clothes.",
    );
  });

  it("return outfit OFF", () => {
    expect(countCallout(7, n(7, false), false)).toBe(
      "Your travel outfit is what you wear on the way there. It's worn, not packed. With no separate return outfit, your return day is packed like any other day. 7 days away, none held back for home = 7 days of everyday clothes.",
    );
  });

  it("a day trip has no middle sentence and no sum", () => {
    expect(countCallout(1, 0, false)).toBe(
      "A day trip: you wear one outfit all day, so it's worn, not packed, and there are no everyday clothes to pack.",
    );
  });

  it("bad dates (0 days) say nothing is left", () => {
    expect(countCallout(0, 0, true)).toContain("That leaves no everyday clothes to pack.");
  });
});

describe("the equation", () => {
  it("is null for a day trip and for bad dates", () => {
    expect(countEquation(1, 0, true)).toBeNull();
    expect(countEquation(0, 0, false)).toBeNull();
  });

  it("uses the singular for one everyday day", () => {
    expect(countEquation(2, 1, true)).toBe("2 days away − 1 for home = 1 day of everyday clothes.");
  });

  it("always agrees with the calculator's own count", () => {
    for (const on of [true, false]) {
      for (let days = 2; days <= 14; days++) {
        expect(countEquation(days, n(days, on), on)).toMatch(
          new RegExp(`= ${n(days, on)} days? of everyday clothes\\.$`),
        );
      }
    }
  });
});

describe("the trip screen's Trip math line", () => {
  it("bad dates keep the short sentence", () => {
    expect(tripMathLine(0, 0, true)).toBe("That leaves no everyday clothes to pack.");
  });
});

describe("a trip counted with the earlier rule", () => {
  const trip = (days: number, dailyDays: number, returnOutfit: boolean) => ({
    days,
    dailyDays,
    config: { returnOutfit },
  });

  it("is stale when the stored count differs from today's rule", () => {
    expect(countedWithEarlierRule(trip(5, 3, true))).toBe(true);
    expect(countedWithEarlierRule(trip(5, 4, true))).toBe(false);
    expect(countedWithEarlierRule(trip(5, 4, false))).toBe(true);
    expect(countedWithEarlierRule(trip(1, 0, false))).toBe(false);
  });

  it("has a fixed note", () => {
    expect(STALE_COUNT_NOTE).toBe(
      "This list was counted with the earlier rule. Edit preferences to update it.",
    );
  });
});
