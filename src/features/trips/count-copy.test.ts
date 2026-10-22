import { describe, expect, it } from "vitest";
import type { ReturnOffPolicy } from "@/domain/calc";
import { dailyDaysFor } from "@/domain/calc/daily-days";
import {
  countCallout,
  countEquation,
  countTiles,
  everydayHeading,
  tripMathLine,
} from "./count-copy";

const EXCLUDE = "exclude-return-day" as const;
const ADD_BACK = "add-return-day-back" as const;
const n = (days: number, on: boolean, policy: ReturnOffPolicy = EXCLUDE) =>
  dailyDaysFor(days, on, policy);

describe("everydayHeading", () => {
  it("says days of everyday clothes, singular for one, and the zero case in words", () => {
    expect(everydayHeading(5)).toBe("5 days of everyday clothes");
    expect(everydayHeading(1)).toBe("1 day of everyday clothes");
    expect(everydayHeading(0)).toBe("No everyday clothes to pack");
  });
});

describe("the tiles", () => {
  const labels = (tiles: { label: string }[]) => tiles.map((tile) => tile.label);
  const values = (tiles: { value: number }[]) => tiles.map((tile) => tile.value);

  it("return outfit ON: days away, worn on the way there, set for the trip home", () => {
    const tiles = countTiles(7, n(7, true), true);
    expect(labels(tiles)).toEqual(["Days away", "Worn on the way there", "Set for the trip home"]);
    expect(values(tiles)).toEqual([7, 1, 1]);
  });

  it("return outfit OFF, today's policy: the third tile is the return day that is not counted, still 1", () => {
    const tiles = countTiles(7, n(7, false), false, EXCLUDE);
    expect(labels(tiles)[2]).toBe("Return day, not counted");
    expect(values(tiles)).toEqual([7, 1, 1]);
    // The tiles add up to the days: 7 − 1 worn − 1 held back = the 5 in the heading.
    expect(7 - 1 - tiles[2].value).toBe(n(7, false));
  });

  it("return outfit OFF, if the return day is added back: packed as usual, 0 held back", () => {
    const tiles = countTiles(7, n(7, false, ADD_BACK), false, ADD_BACK);
    expect(labels(tiles)[2]).toBe("Return day, packed as usual");
    expect(values(tiles)).toEqual([7, 1, 0]);
  });

  it("never goes below 0 for a one-day trip", () => {
    expect(values(countTiles(1, n(1, true), true))).toEqual([1, 1, 0]);
    expect(values(countTiles(2, n(2, true), true))[2]).toBe(1);
  });
});

describe("the callout", () => {
  it("return outfit ON", () => {
    expect(countCallout(7, n(7, true), true)).toBe(
      "You wear one outfit on the way there, so it isn't packed. The trip home gets its own set, packed separately. 7 days away − 1 worn − 1 for home = 5 days of everyday clothes.",
    );
  });

  it("return outfit OFF with today's policy", () => {
    expect(countCallout(7, n(7, false), false, EXCLUDE)).toBe(
      "You wear one outfit on the way there, so it isn't packed. With no separate return outfit, your return day isn't added to the count either. 7 days away − 1 worn − 1 return day = 5 days of everyday clothes.",
    );
  });

  it("return outfit OFF if the return day is added back", () => {
    expect(countCallout(7, n(7, false, ADD_BACK), false, ADD_BACK)).toBe(
      "You wear one outfit on the way there, so it isn't packed. With no separate return outfit, your return day is packed like any other day. 7 days away − 1 worn = 6 days of everyday clothes.",
    );
  });

  it("a very short trip drops the sum and says nothing is left", () => {
    expect(countCallout(2, n(2, true), true)).toBe(
      "You wear one outfit on the way there, so it isn't packed. The trip home gets its own set, packed separately. That leaves no everyday clothes to pack.",
    );
    expect(countCallout(1, n(1, false), false, EXCLUDE)).toContain(
      "That leaves no everyday clothes to pack.",
    );
  });

  it("uses the singular for one day away and for one everyday day", () => {
    expect(countEquation(3, n(3, true), true)).toBe(
      "3 days away − 1 worn − 1 for home = 1 day of everyday clothes.",
    );
    expect(countEquation(2, n(2, false, ADD_BACK), false, ADD_BACK)).toBe(
      "2 days away − 1 worn = 1 day of everyday clothes.",
    );
    expect(countEquation(1, 1, false, ADD_BACK)).toBe(
      "1 day away − 1 worn = 1 day of everyday clothes.",
    );
  });

  it("the sum always agrees with the calculator's own count", () => {
    for (const on of [true, false]) {
      for (const policy of [EXCLUDE, ADD_BACK] as const) {
        for (let days = 1; days <= 14; days++) {
          const everyday = n(days, on, policy);
          const sum = countEquation(days, everyday, on, policy);
          if (everyday === 0) expect(sum).toBeNull();
          else expect(sum).toMatch(new RegExp(`= ${everyday} days? of everyday clothes\\.$`));
        }
      }
    }
  });
});

describe("the trip screen's Trip math line", () => {
  it("is the sum without the lead-in, or the short-trip sentence", () => {
    expect(tripMathLine(7, n(7, false), false)).toBe(
      "7 days away − 1 worn − 1 return day = 5 days of everyday clothes.",
    );
    expect(tripMathLine(7, n(7, true), true)).toBe(
      "7 days away − 1 worn − 1 for home = 5 days of everyday clothes.",
    );
    expect(tripMathLine(2, 0, true)).toBe("That leaves no everyday clothes to pack.");
  });
});
