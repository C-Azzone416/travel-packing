// Ported 1:1 from reference/prototype/tests/core.test.mjs (doc §19): same
// inputs, same expectations. Do not edit these to fit refactors.
import { describe, expect, it } from "vitest";
import {
  calculateSuggestions,
  forecastLabel,
  normalizeTripDates,
  packingDays,
  tripDays,
} from "./index";

describe("prototype core assertions", () => {
  it("passes every original assertion unchanged", () => {
    expect(tripDays("2026-11-12", "2026-11-16"), "dates are inclusive").toBe(5);
    expect(
      packingDays("2026-11-12", "2026-11-16"),
      "outbound and return days are excluded from everyday counts",
    ).toBe(3);
    expect(tripDays("2026-11-16", "2026-11-12"), "invalid reversed dates are rejected").toBe(0);
    expect(
      normalizeTripDates("2026-11-16", "2026-11-12"),
      "an earlier return adjusts to departure",
    ).toEqual({ start: "2026-11-16", end: "2026-11-16", adjusted: true, valid: true });
    expect(normalizeTripDates("2026-11-16", ""), "a missing return adjusts to departure").toEqual({
      start: "2026-11-16",
      end: "2026-11-16",
      adjusted: true,
      valid: true,
    });
    expect(tripDays("2026-11-16", "2026-11-16"), "same-day trips are allowed").toBe(1);
    expect(forecastLabel("2026-10-23", "2026-10-16")).toBe("Close forecast");
    expect(forecastLabel("2026-12-12", "2026-10-16")).toBe("Seasonal outlook");

    const base = calculateSuggestions({
      start: "2026-11-12",
      end: "2026-11-16",
      laundry: false,
      spare: false,
      niceAttire: false,
      occasionCount: 1,
      reuseNice: false,
    });
    expect(base.days).toBe(5);
    expect(base.dailyDays).toBe(3);
    expect(
      base.items.find((item) => item.id === "underwear")?.qty,
      "return underwear is not counted here",
    ).toBe(3);
    expect(
      base.items.find((item) => item.id === "socks")?.qty,
      "return socks are not counted here",
    ).toBe(3);
    expect(
      base.items.some((item) => item.id === "nice-shoes"),
      "nice companion suggestions stay off with the toggle",
    ).toBe(false);

    const withSpareAndLaundry = calculateSuggestions({
      start: "2026-11-12",
      end: "2026-11-18",
      laundry: true,
      spare: true,
      niceAttire: true,
      occasionCount: 2,
      reuseNice: true,
    });
    const find = (id: string) => withSpareAndLaundry.items.find((item) => item.id === id);
    expect(withSpareAndLaundry.dailyDays).toBe(5);
    expect(find("underwear")?.qty).toBe(6);
    expect(
      find("nice-top")?.qty,
      "nice-attire reuse collapses multiple occasions to one look",
    ).toBe(1);
    expect(
      find("nice-shoes")?.qty,
      "dress shoes use one editable default rather than dinner count",
    ).toBe(1);
    expect(
      find("nice-makeup")?.qty,
      "makeup uses one editable default rather than dinner count",
    ).toBe(1);
    expect(
      find("nice-undergarments")?.qty,
      "dress-specific undergarments stay distinct from everyday underwear",
    ).toBe(1);
    expect(
      withSpareAndLaundry.items.filter((item) => item.optional).length,
      "nice companions are marked optional",
    ).toBe(3);
    expect(find("tops")?.qty ?? Infinity, "laundry reduces everyday tops").toBeLessThan(5);
  });
});
