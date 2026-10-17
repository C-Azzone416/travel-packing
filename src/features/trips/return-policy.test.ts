import { afterEach, describe, expect, it, vi } from "vitest";

// The helper text and the calculation must read the same switch (#25): flip it once, both follow.
describe("RETURN_OFF_POLICY drives both the helper text and the calculation", () => {
  afterEach(() => {
    vi.doUnmock("@/domain/calc/return-policy");
    vi.resetModules();
  });

  async function loadWith(policy: "exclude-return-day" | "add-return-day-back") {
    vi.resetModules();
    vi.doMock("@/domain/calc/return-policy", () => ({ RETURN_OFF_POLICY: policy }));
    const { returnOutfitHelp } = await import("./draft");
    const { calculateSuggestions } = await import("@/domain/calc");
    const config = { start: "2026-11-01", end: "2026-11-06", returnOutfit: false };
    const underwear = calculateSuggestions(config).items.find((i) => i.id === "underwear")!.qty;
    return { help: returnOutfitHelp(false), underwear };
  }

  it("excludes the return day under the current policy", async () => {
    const { help, underwear } = await loadWith("exclude-return-day");
    expect(help).toBe(
      "No separate return outfit. Your return day is not added to the everyday count.",
    );
    expect(underwear).toBe(4);
  });

  it("flips the wording and the count together when the policy changes", async () => {
    const { help, underwear } = await loadWith("add-return-day-back");
    expect(help).toBe("Your return day is packed like any other day.");
    expect(underwear).toBe(5);
  });
});
