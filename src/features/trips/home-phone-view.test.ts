import { describe, expect, it } from "vitest";
import { sampleLifecycleState } from "./fixtures";
import {
  homePlaceHash,
  homeStampsView,
  homeStickerLook,
  homeTab,
  phoneTagDates,
} from "./home-phone-view";

describe("Home phone view", () => {
  it("accepts only the four URL tab values and otherwise opens Pack", () => {
    expect(["pack", "weather", "future", "stamps"].map(homeTab)).toEqual([
      "pack",
      "weather",
      "future",
      "stamps",
    ]);
    expect(homeTab(null)).toBe("pack");
    expect(homeTab("archive")).toBe("pack");
  });

  it("formats the compact phone date range without leaking locale time", () => {
    expect(phoneTagDates({ start: "2026-03-14", end: "2026-03-24" })).toBe("14–24 MAR");
    expect(phoneTagDates({ start: "2026-03-30", end: "2026-04-02" })).toBe("30 MAR–02 APR");
    expect(phoneTagDates({ start: "bad", end: "bad" })).toBe("CHOOSE DATES");
  });

  it("uses the accepted deterministic sticker vectors", () => {
    expect(homePlaceHash("pt|lisbon")).toBe(1768105252);
    expect(homeStickerLook("PT", "Lisbon")).toMatchObject({
      shape: "rounded",
      colour: "good",
      tilt: 3,
    });
  });

  it("groups one sticker per place, keeps upcoming dashed, and counts only completed travel", () => {
    const view = homeStampsView(sampleLifecycleState().trips, "2026-10-16", "all");
    expect(view.past.map((trip) => trip.name)).toContain("Lisbon");
    expect(view.stickers.some((sticker) => sticker.upcoming)).toBe(true);
    expect(view.stickers.some((sticker) => !sticker.upcoming)).toBe(true);
    expect(view.inked).toBe(view.stickers.filter((sticker) => !sticker.upcoming).length);
    expect(view.totals.trips).toBe(view.past.length);
    for (const sticker of view.stickers) {
      expect(sticker.accessibleName).toMatch(
        /, (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d, \d+ trips?$/,
      );
    }
  });
});
