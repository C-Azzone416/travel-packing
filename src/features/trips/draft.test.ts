import { describe, expect, it } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import {
  clampOccasions,
  copyDraft,
  DEFAULT_TRIP_CONFIG,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  newDraft,
  returnOutfitHelp,
  withDates,
} from "./draft";

describe("drafts", () => {
  it("a new draft has no destination, no dates and the defaults: return outfit on, Nice outfits off (#205)", () => {
    const draft = newDraft();
    expect(draft).toMatchObject({
      mode: "create",
      sourceId: null,
      location: null,
      start: "",
      end: "",
    });
    expect(draft.config).toEqual(DEFAULT_TRIP_CONFIG);
    expect(draft.config.returnOutfit).toBe(true);
    expect(draft.config.niceAttire).toBe(false);
  });

  it("a copy keeps the source's preferences but not its destination or dates", () => {
    const source = sampleLifecycleState().trips[1];
    const draft = copyDraft(source);
    expect(draft).toMatchObject({
      mode: "copy",
      sourceId: "lisbon",
      location: null,
      start: "",
      end: "",
    });
    expect(draft.config).toEqual(source.config);
    expect(draft.config.laundry).toBe(true);
  });
});

describe("occasions", () => {
  it.each([
    [0, 1],
    [1, 1],
    [4, 4],
    [8, 8],
    [9, 8],
    [-3, 1],
    [2.9, 2],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampOccasions(input)).toBe(expected);
    expect(MIN_OCCASIONS).toBe(1);
    expect(MAX_OCCASIONS).toBe(8);
  });
});

describe("withDates", () => {
  it("accepts a valid range without an adjustment notice", () => {
    const change = withDates(newDraft(), "2026-11-12", "2026-11-16");
    expect(change.adjusted).toBe(false);
    expect(change.draft).toMatchObject({ start: "2026-11-12", end: "2026-11-16" });
  });

  it("allows a same-day trip", () => {
    expect(withDates(newDraft(), "2026-11-12", "2026-11-12")).toMatchObject({
      adjusted: false,
      draft: { start: "2026-11-12", end: "2026-11-12" },
    });
  });

  it("moves an earlier return to the departure and flags it", () => {
    const change = withDates(newDraft(), "2026-11-12", "2026-11-10");
    expect(change.adjusted).toBe(true);
    expect(change.draft).toMatchObject({ start: "2026-11-12", end: "2026-11-12" });
  });

  it("leaves a missing field alone while the user is still typing", () => {
    expect(withDates(newDraft(), "2026-11-12", "")).toMatchObject({
      adjusted: false,
      draft: { start: "2026-11-12", end: "" },
    });
    expect(withDates(newDraft(), "", "2026-11-12")).toMatchObject({
      adjusted: false,
      draft: { start: "", end: "2026-11-12" },
    });
  });
});

describe("returnOutfitHelp", () => {
  it("describes the dedicated outfit when on", () => {
    expect(returnOutfitHelp(true)).toBe(
      "A fresh top, bottoms, underwear and socks for the trip home. It replaces one everyday outfit, for your return day.",
    );
  });

  it("when off, says the return day is packed like any other day (#25, #295)", () => {
    expect(returnOutfitHelp(false)).toBe("Your return day is packed like any other day.");
  });
});
