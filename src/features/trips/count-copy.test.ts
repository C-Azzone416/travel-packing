import { describe, expect, it } from "vitest";
import { dailyDaysFor } from "@/domain/calc/daily-days";
import { countedWithEarlierRule, countEquation, tripMathLine } from "./count-copy";

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
    line: DAY_TRIP,
  },
  {
    name: "overnight, return on",
    days: 2,
    on: true,
    line: `2 days away − 1 for home = 1 day of everyday clothes. ${WORN}`,
  },
  {
    name: "overnight, return off",
    days: 2,
    on: false,
    line: `2 days away, none held back for home = 2 days of everyday clothes. ${WORN}`,
  },
  {
    name: "weekend, return on",
    days: 3,
    on: true,
    line: `3 days away − 1 for home = 2 days of everyday clothes. ${WORN}`,
  },
  {
    name: "weekend, return off",
    days: 3,
    on: false,
    line: `3 days away, none held back for home = 3 days of everyday clothes. ${WORN}`,
  },
  {
    name: "week, return on",
    days: 7,
    on: true,
    line: `7 days away − 1 for home = 6 days of everyday clothes. ${WORN}`,
  },
  {
    name: "week, return off",
    days: 7,
    on: false,
    line: `7 days away, none held back for home = 7 days of everyday clothes. ${WORN}`,
  },
];

describe("the spec table, verbatim", () => {
  it.each(CASES)("$name", ({ days, on, line }) => {
    const everyday = n(days, on);
    expect(tripMathLine(days, everyday, on)).toBe(line);
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
});
