// Boundary tests from the #400 reviews (#405 item 1): each pins an edge that a one-character change would move.
import { describe, expect, it } from "vitest";
import { dropRetracedLegs, unwrapLongitudes, type LngLat } from "./geometry";
import { OCEAN_MIN_SHARE, OCEANS, chooseOcean, oceanShare } from "./oceans";

const ocean = (name: string) => OCEANS.find((o) => o.name === name)!;
const IN_INDIAN: LngLat = [75, -8];
const IN_PACIFIC: LngLat = [-150, 30];
const ON_LAND: LngLat = [-100, 45];

describe("unwrapLongitudes thresholds", () => {
  it("leaves a jump of exactly 180 alone and folds anything beyond it", () => {
    expect(unwrapLongitudes([0, 180])).toEqual([0, 180]);
    expect(unwrapLongitudes([0, -180])).toEqual([0, -180]);
    expect(unwrapLongitudes([0, 181])).toEqual([0, -179]);
    expect(unwrapLongitudes([0, -181])).toEqual([0, 179]);
  });

  it("folds a jump between 181 and 270 the short way round", () => {
    expect(unwrapLongitudes([0, 200])).toEqual([0, -160]);
    expect(unwrapLongitudes([0, 270])).toEqual([0, -90]);
    expect(unwrapLongitudes([10, -200])).toEqual([10, 160]);
  });
});

describe("dropRetracedLegs tolerance edge", () => {
  const out = { from: [0, 0], to: [100, 0] } as const;

  it("drops a return leg whose end is exactly at the tolerance, and keeps one just past it", () => {
    expect(dropRetracedLegs([out, { from: [100, 0], to: [0, 5] }], 5)).toEqual([0]);
    expect(dropRetracedLegs([out, { from: [100, 0], to: [0, 5.01] }], 5)).toEqual([0, 1]);
    expect(dropRetracedLegs([out, { from: [105, 0], to: [0, 0] }], 5)).toEqual([0]);
    expect(dropRetracedLegs([out, { from: [105.01, 0], to: [0, 0] }], 5)).toEqual([0, 1]);
  });
});

describe("ocean choice thresholds", () => {
  const share = (inside: number, total: number): LngLat[] =>
    Array.from({ length: total }, (_, i) => (i < inside ? IN_INDIAN : ON_LAND));

  it("needs a quarter of the samples over the ocean: exactly 0.25 counts, just below does not", () => {
    expect(OCEAN_MIN_SHARE).toBe(0.25);
    expect(chooseOcean(share(25, 100))?.name).toBe("INDIAN OCEAN");
    expect(chooseOcean(share(24, 100))).toBeNull();
    expect(chooseOcean(share(26, 100))?.name).toBe("INDIAN OCEAN");
  });

  it("takes the later ocean when two have the same share (the comparison is >=)", () => {
    const tie = [IN_PACIFIC, IN_PACIFIC, IN_INDIAN, IN_INDIAN];
    expect(oceanShare(tie, ocean("PACIFIC OCEAN"))).toBe(oceanShare(tie, ocean("INDIAN OCEAN")));
    expect(chooseOcean(tie)?.name).toBe("INDIAN OCEAN");
  });

  it("ends the Pacific's eastern box at -126 degrees: on it counts, just east of it does not", () => {
    const pacific = ocean("PACIFIC OCEAN");
    expect(oceanShare([[-126, 30]], pacific)).toBe(1);
    expect(oceanShare([[-125.9, 30]], pacific)).toBe(0);
    expect(oceanShare([[-126.1, 30]], pacific)).toBe(1);
  });
});
