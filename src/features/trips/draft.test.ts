import { describe, expect, it } from "vitest";
import { calculateSuggestions } from "@/domain/calc";
import { LOCATIONS } from "@/domain/locations";
import { selectDraftLocation, setDraftConfig } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import {
  clampOccasions,
  continueBlocker,
  copyDraft,
  DEFAULT_TRIP_CONFIG,
  describeChanges,
  isDirty,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  newDraft,
  returnOutfitHelp,
  withDates,
} from "./draft";

const london = LOCATIONS.find((entry) => entry.id === "gb-eng-london")!;

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

describe("continueBlocker", () => {
  it("asks for a destination first, then for dates, then lets the user continue", () => {
    const draft = newDraft();
    expect(continueBlocker(draft)).toBe("Choose a destination from the list to continue.");
    const withPlace = selectDraftLocation(draft, london);
    expect(continueBlocker(withPlace)).toBe("Choose your departure and return dates to continue.");
    expect(continueBlocker({ ...withPlace, start: "2026-11-12" })).toBe(
      "Choose your departure and return dates to continue.",
    );
    expect(continueBlocker({ ...withPlace, start: "bad", end: "2026-11-16" })).toBe(
      "Choose your departure and return dates to continue.",
    );
    expect(continueBlocker({ ...withPlace, start: "2026-11-12", end: "2026-11-16" })).toBeNull();
  });
});

describe("isDirty", () => {
  const initial = newDraft();

  it("is false for an untouched draft and true once anything changes", () => {
    expect(isDirty(initial, initial, "")).toBe(false);
    expect(isDirty(initial, initial, "   ")).toBe(false);
    expect(isDirty(initial, initial, "lon")).toBe(true);
    expect(isDirty(selectDraftLocation(initial, london), initial, "")).toBe(true);
    expect(isDirty({ ...initial, start: "2026-11-12" }, initial, "")).toBe(true);
    expect(
      isDirty(setDraftConfig(initial, { ...initial.config, laundry: true }), initial, ""),
    ).toBe(true);
  });

  it("ignores key order inside the preferences", () => {
    const reordered = {
      ...initial,
      config: Object.fromEntries(Object.entries(initial.config).reverse()) as typeof initial.config,
    };
    expect(isDirty(reordered, initial, "")).toBe(false);
  });
});

describe("describeChanges", () => {
  const range = { start: "2026-11-12", end: "2026-11-18" };
  const calc = (patch: object) =>
    calculateSuggestions({ ...DEFAULT_TRIP_CONFIG, ...range, ...patch });

  it("names changed quantities", () => {
    expect(
      describeChanges(
        calc({ laundry: false, niceAttire: false }),
        calc({ laundry: true, niceAttire: false }),
      ),
    ).toBe("Everyday tops: 3, Everyday bottoms: 2");
  });

  it("reports items that disappeared as 0 and items that appeared with their quantity", () => {
    const withNice = calc({ niceAttire: true });
    const without = calc({ niceAttire: false });
    expect(describeChanges(withNice, without)).toContain("Dress shoes: 0");
    expect(describeChanges(without, withNice)).toContain("Dress shoes: 1");
  });

  it("says so when nothing changed", () => {
    expect(describeChanges(calc({}), calc({}))).toBe("List unchanged");
  });
});

describe("returnOutfitHelp", () => {
  it("describes the dedicated outfit when on", () => {
    expect(returnOutfitHelp(true)).toBe(
      "A fresh top, bottoms, underwear and socks for the trip home. It replaces one everyday outfit, for your return day.",
    );
    expect(returnOutfitHelp(true, "add-return-day-back")).toBe(
      "A fresh top, bottoms, underwear and socks for the trip home. It replaces one everyday outfit, for your return day.",
    );
  });

  it("when off, matches what the calculator actually does under each policy (#25)", () => {
    expect(returnOutfitHelp(false, "exclude-return-day")).toBe(
      "No separate return outfit. Your return day is not added to the everyday count.",
    );
    expect(returnOutfitHelp(false, "add-return-day-back")).toBe(
      "Your return day is packed like any other day.",
    );
  });

  it("defaults to the policy currently in force", () => {
    expect(returnOutfitHelp(false)).toBe(returnOutfitHelp(false, "add-return-day-back"));
  });
});
