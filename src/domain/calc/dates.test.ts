import { describe, expect, it } from "vitest";
import { forecastLabel, normalizeTripDates, packingDays, parseDate, tripDays } from "./dates";

describe("parseDate", () => {
  it("reads date-only strings as UTC midnight", () => {
    expect(parseDate("2026-11-12")?.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it.each([
    undefined,
    null,
    "",
    "2026-11",
    "2026-11-12-01",
    "abc-de-fg",
    "2026-1-5",
    "2026-11-12T00:00:00Z",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-11-00",
  ])("rejects %j", (value) => {
    expect(parseDate(value)).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseDate("2028-02-29")).not.toBeNull();
    expect(parseDate("2027-02-29")).toBeNull();
  });
});

describe("tripDays", () => {
  it.each([
    ["2026-11-12", "2026-11-12", 1],
    ["2026-11-12", "2026-11-13", 2],
    ["2026-11-29", "2026-12-02", 4],
    ["2026-12-30", "2027-01-02", 4],
    ["2028-02-28", "2028-03-01", 3],
    ["2026-10-31", "2026-11-02", 3],
    ["2026-03-07", "2026-03-09", 3],
  ])("%s → %s is %i days (month, year, leap and DST boundaries)", (start, end, expected) => {
    expect(tripDays(start, end)).toBe(expected);
  });

  it.each([
    ["2026-11-16", "2026-11-12"],
    ["", "2026-11-12"],
    ["2026-11-12", ""],
    [undefined, "2026-11-12"],
    ["2026-11-12", undefined],
    ["2026-11", "2026-11-12"],
    ["2026-11-12", "abc-de-fg"],
  ])("is 0 for reversed or invalid input (%j, %j)", (start, end) => {
    expect(tripDays(start, end)).toBe(0);
  });
});

describe("packingDays", () => {
  it.each([
    [0, "2026-11-16", "2026-11-12"],
    [0, "2026-11-12", "2026-11-12"],
    [0, "2026-11-12", "2026-11-13"],
    [1, "2026-11-12", "2026-11-14"],
    [3, "2026-11-12", "2026-11-16"],
  ])("is %i for %s → %s", (expected, start, end) => {
    expect(packingDays(start, end)).toBe(expected);
  });
});

describe("normalizeTripDates", () => {
  it("leaves a valid range untouched", () => {
    expect(normalizeTripDates("2026-11-12", "2026-11-16")).toEqual({
      start: "2026-11-12",
      end: "2026-11-16",
      adjusted: false,
      valid: true,
    });
  });

  it("keeps a same-day range unadjusted", () => {
    expect(normalizeTripDates("2026-11-12", "2026-11-12")).toEqual({
      start: "2026-11-12",
      end: "2026-11-12",
      adjusted: false,
      valid: true,
    });
  });

  it("adjusts a malformed return to the departure", () => {
    expect(normalizeTripDates("2026-11-12", "nope")).toEqual({
      start: "2026-11-12",
      end: "2026-11-12",
      adjusted: true,
      valid: true,
    });
  });

  it.each([
    [undefined, undefined, { start: "", end: "", adjusted: false, valid: false }],
    ["", "2026-11-16", { start: "", end: "2026-11-16", adjusted: false, valid: false }],
    [
      "2026-11",
      "2026-11-16",
      { start: "2026-11", end: "2026-11-16", adjusted: false, valid: false },
    ],
    [null, null, { start: "", end: "", adjusted: false, valid: false }],
  ])("flags a missing or malformed departure as invalid (%j, %j)", (start, end, expected) => {
    expect(normalizeTripDates(start, end)).toEqual(expected);
  });
});

describe("forecastLabel", () => {
  it.each([
    ["2026-10-16", "Close forecast"],
    ["2026-10-26", "Close forecast"],
    ["2026-10-27", "Seasonal outlook"],
    ["2026-10-15", "Seasonal outlook"],
  ])("departure %s with today 2026-10-16 is %s", (start, expected) => {
    expect(forecastLabel(start, "2026-10-16")).toBe(expected);
  });

  it.each([
    ["bad", "2026-10-16"],
    ["2026-10-20", undefined],
    ["2026-10-20", ""],
    ["2026-10-20", "bad"],
    [undefined, "2026-10-16"],
  ])(
    "falls back to the seasonal outlook for invalid input (%j, %j), with no clock fallback",
    (start, today) => {
      expect(forecastLabel(start, today)).toBe("Seasonal outlook");
    },
  );
});
