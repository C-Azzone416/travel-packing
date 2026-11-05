import { describe, expect, it } from "vitest";
import {
  accessibleName,
  angleDeg,
  angularDistanceDeg,
  centerLng,
  clamp,
  dropRetracedLegs,
  ensureMinSpan,
  extentOf,
  greatCircle,
  legSegments,
  MAX_LAT,
  normalizeLng,
  pointCode,
  routeCodes,
  routeLegs,
  unwrapLongitudes,
  type RoutePoint,
} from "./geometry";

const home: RoutePoint = { kind: "home", label: "Seattle", code: "sea", lat: 47.45, lng: -122.3 };
const lisbon: RoutePoint = { kind: "stop", label: "Lisbon", code: "LIS", lat: 38.77, lng: -9.13 };
const porto: RoutePoint = { kind: "stop", label: "Porto", lat: 41.24, lng: -8.68 };

describe("clamp and normalizeLng", () => {
  it("clamps both ways", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
  it("folds longitude into [-180, 180)", () => {
    expect(normalizeLng(190)).toBe(-170);
    expect(normalizeLng(-190)).toBe(170);
    expect(normalizeLng(10)).toBe(10);
    expect(normalizeLng(180)).toBe(-180);
  });
});

describe("unwrapLongitudes", () => {
  it("leaves a route that does not cross the antimeridian alone", () => {
    expect(unwrapLongitudes([-122, -9, -8])).toEqual([-122, -9, -8]);
  });
  it("takes the short way across the antimeridian, going west", () => {
    expect(unwrapLongitudes([-158, 140])).toEqual([-158, -220]);
  });
  it("takes the short way across the antimeridian, going east", () => {
    expect(unwrapLongitudes([140, -158])).toEqual([140, 202]);
  });
  it("handles several turns and empty input", () => {
    expect(unwrapLongitudes([170, -170, 170])).toEqual([170, 190, 170]);
    expect(unwrapLongitudes([])).toEqual([]);
  });
});

describe("angularDistanceDeg and legSegments", () => {
  it("measures a quarter of the way round the equator", () => {
    expect(angularDistanceDeg([0, 0], [90, 0])).toBeCloseTo(90, 6);
    expect(angularDistanceDeg([0, 0], [0, 0])).toBeCloseTo(0, 6);
    expect(angularDistanceDeg([0, 90], [0, -90])).toBeCloseTo(180, 6);
  });
  it("uses more segments for longer legs, within bounds", () => {
    expect(legSegments(1)).toBe(8);
    expect(legSegments(60)).toBe(30);
    expect(legSegments(500)).toBe(90);
  });
});

describe("greatCircle", () => {
  it("includes both endpoints and the requested number of segments", () => {
    const line = greatCircle([0, 0], [90, 0], 9);
    expect(line).toHaveLength(10);
    expect(line[0]).toEqual([0, 0]);
    expect(line[9]![0]).toBeCloseTo(90, 6);
    expect(line[9]![1]).toBeCloseTo(0, 6);
  });
  it("is the great circle, not the straight line: Seattle to Lisbon bows north", () => {
    const line = greatCircle([home.lng, home.lat], [lisbon.lng, lisbon.lat]);
    const maxLat = Math.max(...line.map((p) => p[1]));
    expect(maxLat).toBeGreaterThan(55);
    // Every point sits on the sphere path: each step is the same angular size.
    const steps = line.slice(1).map((p, i) => angularDistanceDeg(line[i]!, p));
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-6);
  });
  it("midpoint of two equatorial points is on the equator between them", () => {
    const [, mid] = greatCircle([10, 0], [50, 0], 2);
    expect(mid![0]).toBeCloseTo(30, 6);
    expect(mid![1]).toBeCloseTo(0, 6);
  });
  it("keeps longitude continuous across the antimeridian", () => {
    const line = greatCircle([-158, 21], [140, 35]);
    for (let i = 1; i < line.length; i += 1) {
      expect(Math.abs(line[i]![0] - line[i - 1]![0])).toBeLessThan(20);
    }
    expect(line[line.length - 1]![0]).toBeCloseTo(-220, 3);
  });
  it("honours an already-unwrapped start longitude", () => {
    const line = greatCircle([-200, 10], [-210, 10], 4);
    expect(line[0]![0]).toBe(-200);
    expect(line[4]![0]).toBeCloseTo(-210, 6);
  });
  it("handles the same place twice and exact opposites without NaN", () => {
    const same = greatCircle([5, 5], [5, 5], 4);
    expect(same.every((p) => p[0] === 5 && p[1] === 5)).toBe(true);
    const opposite = greatCircle([0, 0], [180, 0], 4);
    expect(opposite).toHaveLength(5);
    expect(opposite.flat().every(Number.isFinite)).toBe(true);
    expect(opposite[4]![0]).toBeCloseTo(180, 6);
  });
});

describe("routeLegs", () => {
  it("runs home to each stop in order and back home", () => {
    const legs = routeLegs([lisbon, home, porto]);
    expect(legs).toHaveLength(3);
    expect(legs[0]![0]).toEqual([home.lng, home.lat]);
    expect(legs[1]![0]![0]).toBeCloseTo(lisbon.lng, 6);
    expect(legs[2]![0]![0]).toBeCloseTo(porto.lng, 6);
    const last = legs[2]!;
    expect(last[last.length - 1]![0]).toBeCloseTo(home.lng, 3);
  });
  it("with stops only, runs stop to stop and does not come back", () => {
    expect(routeLegs([lisbon, porto])).toHaveLength(1);
  });
  it("has no legs for one point or none", () => {
    expect(routeLegs([lisbon])).toEqual([]);
    expect(routeLegs([home])).toEqual([]);
    expect(routeLegs([])).toEqual([]);
  });
  it("one stop with a home is out and back", () => {
    expect(routeLegs([home, lisbon])).toHaveLength(2);
  });
  it("chains unwrapped longitudes across the antimeridian", () => {
    const hnl: RoutePoint = { kind: "home", label: "Honolulu", lat: 21.3, lng: -157.9 };
    const tokyo: RoutePoint = { kind: "stop", label: "Tokyo", lat: 35.7, lng: 139.7 };
    const legs = routeLegs([hnl, tokyo]);
    const out = legs[0]!;
    const back = legs[1]!;
    expect(out[out.length - 1]![0]).toBeCloseTo(-220.3, 1);
    expect(back[0]![0]).toBeCloseTo(-220.3, 1);
    expect(back[back.length - 1]![0]).toBeCloseTo(-157.9, 1);
  });
});

describe("extentOf and ensureMinSpan", () => {
  it("is the bounding box", () => {
    expect(
      extentOf([
        [10, 20],
        [-5, 40],
        [30, -10],
      ]),
    ).toEqual({ west: -5, east: 30, south: -10, north: 40 });
  });
  it("keeps latitude inside Mercator's range", () => {
    const e = extentOf([
      [0, -89],
      [0, 89],
    ]);
    expect(e.south).toBe(-MAX_LAT);
    expect(e.north).toBe(MAX_LAT);
  });
  it("falls back to a wide default view for no points", () => {
    const e = extentOf([]);
    expect(e.east).toBeGreaterThan(e.west);
    expect(e.north).toBeGreaterThan(e.south);
  });
  it("grows a single point to the minimum span around it", () => {
    const e = ensureMinSpan({ west: 10, east: 10, south: 40, north: 40 }, 8);
    expect(e).toEqual({ west: 6, east: 14, south: 36, north: 44 });
  });
  it("does not shrink a bigger box", () => {
    const e = ensureMinSpan({ west: 0, east: 30, south: 0, north: 20 }, 8);
    expect(e).toEqual({ west: 0, east: 30, south: 0, north: 20 });
  });
  it("slides away from the poles instead of squashing", () => {
    const north = ensureMinSpan({ west: 0, east: 1, south: 79, north: 79 }, 8);
    expect(north.north).toBe(MAX_LAT);
    expect(north.north - north.south).toBe(8);
    const south = ensureMinSpan({ west: 0, east: 1, south: -79, north: -79 }, 8);
    expect(south.south).toBe(-MAX_LAT);
    expect(south.north - south.south).toBe(8);
  });
  it("never goes wider than one turn", () => {
    const e = ensureMinSpan({ west: -400, east: 400, south: 0, north: 1 }, 8);
    expect(e.east - e.west).toBe(360);
  });
  it("centerLng is the middle", () => {
    expect(centerLng({ west: -220, east: -150, south: 0, north: 1 })).toBe(-185);
  });
});

describe("angleDeg", () => {
  it("is 0 to the right, 90 down, -90 up, 180 left", () => {
    expect(angleDeg([0, 0], [5, 0])).toBe(0);
    expect(angleDeg([0, 0], [0, 5])).toBe(90);
    expect(angleDeg([0, 0], [0, -5])).toBe(-90);
    expect(angleDeg([0, 0], [-5, 0])).toBe(180);
  });
});

describe("dropRetracedLegs", () => {
  const leg = (a: [number, number], b: [number, number]) => ({ from: a, to: b });
  it("drops the way back over the same path", () => {
    expect(dropRetracedLegs([leg([0, 0], [100, 0]), leg([100, 0], [0, 0])], 10)).toEqual([0]);
  });
  it("drops a leg that repeats another in the same direction", () => {
    expect(dropRetracedLegs([leg([0, 0], [100, 0]), leg([2, 1], [101, 1])], 10)).toEqual([0]);
  });
  it("drops a way back to a stop that sits right next to the first one", () => {
    const legs = [leg([0, 0], [100, 0]), leg([100, 0], [100, 20]), leg([100, 20], [0, 0])];
    expect(dropRetracedLegs(legs, 25)).toEqual([0, 1]);
  });
  it("keeps legs that go somewhere new", () => {
    expect(dropRetracedLegs([leg([0, 0], [100, 0]), leg([100, 0], [100, 80])], 10)).toEqual([0, 1]);
  });
  it("needs both ends to be close, not just one", () => {
    expect(dropRetracedLegs([leg([0, 0], [100, 0]), leg([100, 0], [0, 60])], 10)).toEqual([0, 1]);
    expect(dropRetracedLegs([leg([0, 0], [100, 0]), leg([100, 60], [0, 0])], 10)).toEqual([0, 1]);
  });
});

describe("codes and the accessible name", () => {
  it("uses the given code upper-cased, else the first three letters of the label", () => {
    expect(pointCode(home)).toBe("SEA");
    expect(pointCode(porto)).toBe("POR");
    expect(pointCode({ label: "  São Paulo", code: "  " })).toBe("SÃO");
    expect(pointCode({ label: "St. Louis" })).toBe("STL");
  });
  it("writes home, stops, home", () => {
    expect(routeCodes([lisbon, porto, home])).toBe("SEA → LIS → POR → SEA");
  });
  it("writes stops only without a loop", () => {
    expect(routeCodes([lisbon, porto])).toBe("LIS → POR");
  });
  it("names the route from the labels", () => {
    expect(accessibleName([home, lisbon, porto])).toBe(
      "Route map: Seattle to Lisbon to Porto and back",
    );
    expect(accessibleName([home, lisbon])).toBe("Route map: Seattle to Lisbon and back");
  });
  it("has no 'and back' without a home", () => {
    expect(accessibleName([lisbon, porto])).toBe("Route map: Lisbon to Porto");
    expect(accessibleName([lisbon])).toBe("Route map: Lisbon");
  });
  it("is just the home when there are no stops, and plain when empty", () => {
    expect(accessibleName([home])).toBe("Route map: Seattle");
    expect(accessibleName([])).toBe("Route map");
    expect(accessibleName([{ ...home, label: "  " }])).toBe("Route map");
  });
});
