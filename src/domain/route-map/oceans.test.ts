import { describe, expect, it } from "vitest";
import {
  chooseOcean,
  distanceToRect,
  estimateLabelWidth,
  OCEANS,
  oceanShare,
  placeLabel,
  polylineNearRect,
  type Rect,
} from "./oceans";
import { greatCircle } from "./geometry";

const atlantic = OCEANS[0]!;
const pacific = OCEANS[1]!;

describe("oceanShare and chooseOcean", () => {
  it("is the share of samples over the ocean", () => {
    expect(
      oceanShare(
        [
          [-40, 30],
          [-40, 31],
          [10, 30],
          [20, 30],
        ],
        atlantic,
      ),
    ).toBe(0.5);
    expect(oceanShare([], atlantic)).toBe(0);
  });
  it("picks the Atlantic for Seattle to Lisbon", () => {
    expect(chooseOcean(greatCircle([-122, 47], [-9, 38]))?.name).toBe("ATLANTIC OCEAN");
  });
  it("picks the Pacific for Honolulu to Tokyo, across the antimeridian", () => {
    expect(chooseOcean(greatCircle([-158, 21], [-220, 35]))?.name).toBe("PACIFIC OCEAN");
    expect(chooseOcean(greatCircle([-158, 21], [140, 35]))?.name).toBe("PACIFIC OCEAN");
  });
  it("picks the Indian Ocean for Mumbai to Perth", () => {
    expect(chooseOcean(greatCircle([72.9, 19], [115.9, -31.9]))?.name).toBe("INDIAN OCEAN");
  });
  it("picks none for a route over land", () => {
    expect(chooseOcean(greatCircle([-87.9, 42], [-104.7, 39.9]))).toBeNull();
    expect(chooseOcean([])).toBeNull();
  });
  it("needs a real share of the route, not a corner", () => {
    // 1 point in 8 over the Atlantic is under the 25% bar.
    const samples = [[-40, 30], ...Array.from({ length: 7 }, () => [10, 30])] as [number, number][];
    expect(chooseOcean(samples)).toBeNull();
  });
  it("prefers the ocean with the larger share", () => {
    const samples = [
      [-40, 30],
      [-40, 30],
      [-170, 20],
      [-170, 20],
      [-170, 20],
    ] as [number, number][];
    expect(chooseOcean(samples)).toBe(pacific);
  });
});

describe("estimateLabelWidth", () => {
  it("grows with letters and font size", () => {
    expect(estimateLabelWidth("ABCDE", 10)).toBe(40);
    expect(estimateLabelWidth("ABCDE", 20)).toBe(80);
  });
});

describe("distanceToRect and polylineNearRect", () => {
  const rect: Rect = { x: 10, y: 10, width: 20, height: 10 };
  it("is 0 inside, straight-line outside, and diagonal at corners", () => {
    expect(distanceToRect([15, 15], rect)).toBe(0);
    expect(distanceToRect([0, 15], rect)).toBe(10);
    expect(distanceToRect([20, 40], rect)).toBe(20);
    expect(distanceToRect([33, 24], rect)).toBe(5);
  });
  it("sees a line that crosses the rectangle even when no vertex is near it", () => {
    expect(
      polylineNearRect(
        [
          [0, 15],
          [100, 15],
        ],
        rect,
        2,
      ),
    ).toBe(true);
  });
  it("sees a line that passes within the clearance, not beyond", () => {
    const line: [number, number][] = [
      [0, 30],
      [100, 30],
    ];
    expect(polylineNearRect(line, rect, 12)).toBe(true);
    expect(polylineNearRect(line, rect, 9)).toBe(false);
  });
  it("handles a single point and an empty line", () => {
    expect(polylineNearRect([[15, 15]], rect, 1)).toBe(true);
    expect(polylineNearRect([[200, 200]], rect, 1)).toBe(false);
    expect(polylineNearRect([], rect, 1)).toBe(false);
  });
});

describe("placeLabel", () => {
  const base = {
    width: 40,
    height: 10,
    viewport: { width: 200, height: 100 },
    margin: 5,
    avoid: [] as (readonly [number, number][])[],
    clearance: 4,
  };
  it("takes the first candidate that fits", () => {
    expect(
      placeLabel({
        ...base,
        candidates: [
          [100, 50],
          [50, 50],
        ],
      }),
    ).toEqual([100, 50]);
  });
  it("skips candidates that stick out past the margin on each side", () => {
    const ok: [number, number] = [100, 50];
    const out: [number, number][] = [
      [20, 50], // left edge at 0 < margin
      [180, 50], // right edge at 200 > 195
      [100, 5], // top
      [100, 95], // bottom
    ];
    expect(placeLabel({ ...base, candidates: [...out, ok] })).toEqual(ok);
    expect(placeLabel({ ...base, candidates: out })).toBeNull();
  });
  it("accepts a candidate exactly on the margin", () => {
    expect(placeLabel({ ...base, candidates: [[25, 10]] })).toEqual([25, 10]);
    expect(placeLabel({ ...base, candidates: [[175, 90]] })).toEqual([175, 90]);
  });
  it("skips candidates touching the route or a pin, and returns null when none is clear", () => {
    const route: [number, number][] = [
      [0, 50],
      [200, 50],
    ];
    const pin: [number, number][] = [[50, 20]];
    const result = placeLabel({
      ...base,
      avoid: [route, pin],
      candidates: [
        [100, 50], // on the route
        [50, 25], // beside the pin
        [100, 80],
      ],
    });
    expect(result).toEqual([100, 80]);
    expect(placeLabel({ ...base, avoid: [route], candidates: [[100, 50]] })).toBeNull();
    expect(placeLabel({ ...base, candidates: [] })).toBeNull();
  });
});
