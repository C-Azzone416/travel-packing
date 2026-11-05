import { describe, expect, it } from "vitest";
import { stopsOrDestination, tripFacts, tripRoutePoints } from "./trip-route";
import type { SampleLocation, TripStop } from "./trip-stops";

const place = (id: string, city: string, extra: Partial<SampleLocation> = {}): SampleLocation => ({
  id,
  city,
  region: "",
  country: "",
  countryCode: "",
  label: city,
  ...extra,
});
const at = (
  id: string,
  city: string,
  code?: string,
  extra: Partial<SampleLocation> = {},
): TripStop => ({
  location: place(id, city, extra),
  arrive: "2030-05-01",
  leave: "2030-05-04",
  ...(code ? { airportCode: code } : {}),
});

describe("a trip with no stops (#419)", () => {
  it("leaves the city count out of the facts instead of saying 0 cities", () => {
    expect(tripFacts({ travelMode: "fly", nights: 4, stops: [] })).toBe("flight · 4 nights");
    expect(tripFacts({ nights: 0, stops: [] })).toBe("day trip");
  });
});

describe("stopsOrDestination", () => {
  const where = place("pt-lisbon", "Lisbon");
  const stops = [at("pt-lisbon", "Lisbon"), at("x", "Porto")];

  it("is the stops when there are some", () => {
    expect(stopsOrDestination({ stops, location: where, start: "a", end: "b" })).toEqual(stops);
  });

  it("is the one destination as a stop when there are none, and empty with no destination", () => {
    expect(
      stopsOrDestination({ stops: [], location: where, start: "2030-05-01", end: "2030-05-04" }),
    ).toEqual([{ location: where, arrive: "2030-05-01", leave: "2030-05-04" }]);
    expect(stopsOrDestination({ stops: [], location: null, start: "a", end: "b" })).toEqual([]);
    expect(stopsOrDestination({ stops: [], start: "a", end: "b" })).toEqual([]);
  });
});

describe("tripRoutePoints", () => {
  it("is the origin as home, then each stop, using curated coordinates for curated places", () => {
    const points = tripRoutePoints({
      origin: { location: place("us-wa-seattle", "Seattle"), airportCode: "SEA" },
      stops: [
        at("pt-lisbon", "Lisbon", "LIS"),
        at("nowhere", "Porto", "OPO", { latitude: 41.15, longitude: -8.61 }),
      ],
      start: "2030-05-01",
      end: "2030-05-08",
    });
    expect(points.map((p) => [p.kind, p.label, p.code])).toEqual([
      ["home", "Seattle", "SEA"],
      ["stop", "Lisbon", "LIS"],
      ["stop", "Porto", "OPO"],
    ]);
    expect(points[2]).toMatchObject({ lat: 41.15, lng: -8.61 });
    expect(points[1]).toMatchObject({ lat: 38.72, lng: -9.14 });
  });

  it("leaves out places with no known coordinates and has no home without an origin", () => {
    const points = tripRoutePoints({
      origin: null,
      stops: [at("pt-lisbon", "Lisbon"), at("unknown-place", "Nowhere")],
      start: "a",
      end: "b",
    });
    expect(points.map((p) => p.label)).toEqual(["Lisbon"]);
    expect(points[0].code).toBeUndefined();
  });

  it("uses the destination when there are no stops, and is empty when no stop can be placed", () => {
    expect(
      tripRoutePoints({
        stops: [],
        location: place("pt-lisbon", "Lisbon"),
        start: "a",
        end: "b",
      }).map((p) => p.label),
    ).toEqual(["Lisbon"]);
    expect(
      tripRoutePoints({
        origin: { location: place("us-wa-seattle", "Seattle") },
        stops: [at("unknown-place", "Nowhere")],
        start: "a",
        end: "b",
      }),
    ).toEqual([]);
    expect(tripRoutePoints({ stops: [], start: "a", end: "b" })).toEqual([]);
  });

  it("skips an origin that cannot be placed but still draws the stops", () => {
    const points = tripRoutePoints({
      origin: { location: place("unknown-home", "Smallville") },
      stops: [at("pt-lisbon", "Lisbon")],
      start: "a",
      end: "b",
    });
    expect(points.map((p) => p.kind)).toEqual(["stop"]);
  });
});
