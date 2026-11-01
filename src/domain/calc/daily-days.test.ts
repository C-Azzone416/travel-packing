import { describe, expect, it } from "vitest";
import { dailyDaysFor } from "./daily-days";

// #295: every trip day needs an everyday outfit, except the last when the dedicated return outfit covers it; the travel outfit
// is worn, not packed; a same-day trip packs none.
describe("dailyDaysFor", () => {
  it.each([
    [0, true, 0],
    [0, false, 0],
    [1, true, 0],
    [1, false, 0],
    [2, true, 1],
    [2, false, 2],
    [3, true, 2],
    [3, false, 3],
    [7, true, 6],
    [7, false, 7],
  ])("%i days, return outfit %s: %i everyday outfits", (days, returnOutfit, expected) => {
    expect(dailyDaysFor(days, returnOutfit)).toBe(expected);
  });
});
