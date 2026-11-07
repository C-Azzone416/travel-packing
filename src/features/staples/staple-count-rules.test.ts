import { describe, expect, it } from "vitest";
import {
  STAPLE_COUNT_RULES,
  stapleCountRule,
  stapleCountRuleDescription,
} from "./staple-count-rules";

describe("Staples count-rule copy", () => {
  it("has one shared rule for every supported cadence", () => {
    expect(STAPLE_COUNT_RULES.map((rule) => rule.cadence)).toEqual([
      "per trip",
      "per day",
      "per night",
      "smart",
    ]);
    expect(stapleCountRule("per night").label).toBe("Per night");
  });

  it("adds only the setup context that varies by item", () => {
    expect(
      stapleCountRuleDescription("per day", { laundryHalves: true, smartSupported: false }),
    ).toBe(
      "Multiplies by every calendar day, including travel days. Halves (rounding up) when the trip has laundry.",
    );
    expect(
      stapleCountRuleDescription("per day", { laundryHalves: false, smartSupported: false }),
    ).toBe("Multiplies by every calendar day, including travel days. Laundry does not change it.");
    expect(
      stapleCountRuleDescription("smart", { laundryHalves: false, smartSupported: false }),
    ).toBe("Available only for supported clothing staples.");
    expect(
      stapleCountRuleDescription("smart", { laundryHalves: false, smartSupported: true }),
    ).toBe("Uses the shared clothing rules, including trip preferences.");
    expect(
      stapleCountRuleDescription("per trip", { laundryHalves: false, smartSupported: false }),
    ).toBe("The same amount on every trip.");
  });
});
