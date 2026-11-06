import { describe, expect, it } from "vitest";
import { curatedCoordinates } from "./curated-coordinates";
import { LOCATIONS } from "./locations";

describe("curated coordinates", () => {
  it("has a valid point for every curated destination", () => {
    for (const place of LOCATIONS) {
      const point = curatedCoordinates(place.id);
      expect(point, place.id).not.toBeNull();
      expect(Math.abs(point!.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(point!.lng)).toBeLessThanOrEqual(180);
    }
  });

  it("puts a few places where they are", () => {
    expect(curatedCoordinates("pt-lisbon")).toEqual({ lat: 38.72, lng: -9.14 });
    expect(curatedCoordinates("jp-13-tokyo")!.lng).toBeGreaterThan(139);
    expect(curatedCoordinates("au-nsw-sydney")!.lat).toBeLessThan(0);
  });

  it("returns null for an unknown id, never a guess (including inherited object keys)", () => {
    expect(curatedCoordinates("xx-nowhere")).toBeNull();
    expect(curatedCoordinates("toString")).toBeNull();
    expect(curatedCoordinates("")).toBeNull();
  });
});
