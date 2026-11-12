import { describe, expect, it } from "vitest";
import {
  citiesText,
  distinctCities,
  joinCities,
  nightsText,
  normaliseTripName,
  routeCaption,
  routePointLabel,
  routeText,
  routeTextShort,
  tripDisplayName,
  tripFacts,
  withHomeOrigin,
  TRAVEL_MODE_CAPTION,
  TRAVEL_MODE_LABEL,
  TRAVEL_MODES,
  type TripOrigin,
} from "./trip-route";
import type { TripStop } from "./trip-stops";

const stop = (city: string, airportCode?: string): TripStop => ({
  location: { id: city, city, region: "", country: "", countryCode: "", label: city },
  arrive: "2030-05-01",
  leave: "2030-05-04",
  ...(airportCode ? { airportCode } : {}),
});
const origin = (city: string, airportCode?: string): TripOrigin => ({
  location: stop(city).location,
  ...(airportCode ? { airportCode } : {}),
});
const LIS_OPO = [stop("Lisbon", "LIS"), stop("Porto", "OPO")];

describe("travel modes", () => {
  it("are fly, drive and other, with the spec's captions and labels", () => {
    expect(TRAVEL_MODES).toEqual(["fly", "drive", "other"]);
    expect(TRAVEL_MODE_CAPTION).toEqual({ fly: "flight", drive: "drive", other: "train or other" });
    expect(TRAVEL_MODE_LABEL).toEqual({ fly: "Fly", drive: "Drive", other: "Train or other" });
  });
});

describe("normaliseTripName", () => {
  it("trims, and blank or missing is no name", () => {
    expect(normaliseTripName("  Spring  ")).toBe("Spring");
    expect(normaliseTripName("   ")).toBeNull();
    expect(normaliseTripName("")).toBeNull();
    expect(normaliseTripName(null)).toBeNull();
    expect(normaliseTripName(undefined)).toBeNull();
  });
});

describe("cities and the display name", () => {
  it("joins one, two and three or more cities the way the spec writes them", () => {
    expect(joinCities([])).toBe("");
    expect(joinCities(["Lisbon"])).toBe("Lisbon");
    expect(joinCities(["Lisbon", "Porto"])).toBe("Lisbon & Porto");
    expect(joinCities(["A", "B", "C"])).toBe("A, B & C");
    expect(joinCities(["A", "B", "C", "D"])).toBe("A, B, C & D");
  });

  it("lists distinct cities in order, ignoring case, blanks and repeats", () => {
    expect(distinctCities([stop("Lisbon"), stop("Porto"), stop(" lisbon "), stop(" ")])).toEqual([
      "Lisbon",
      "Porto",
    ]);
  });

  it("uses the owner's name, else the stops, else the stored destination", () => {
    expect(tripDisplayName({ name: " Spring break ", stops: LIS_OPO })).toBe("Spring break");
    expect(tripDisplayName({ name: null, stops: LIS_OPO })).toBe("Lisbon & Porto");
    expect(tripDisplayName({ stops: LIS_OPO })).toBe("Lisbon & Porto");
    expect(tripDisplayName({ name: "  ", stops: [stop("A"), stop("B"), stop("C")] })).toBe(
      "A, B & C",
    );
    expect(tripDisplayName({ name: null, stops: [], destination: " Exampleville " })).toBe(
      "Exampleville",
    );
    expect(tripDisplayName({ stops: [] })).toBe("");
  });
});

describe("route text", () => {
  it("labels a point by its airport code, else its city", () => {
    expect(routePointLabel(stop("Lisbon", "LIS"))).toBe("LIS");
    expect(routePointLabel(stop(" Porto "))).toBe("Porto");
    expect(routePointLabel(stop("Lisbon", "lis"))).toBe("Lisbon");
    expect(routePointLabel(stop("Lisbon", "LISB"))).toBe("Lisbon");
  });

  it("goes from the origin through each stop and back", () => {
    expect(routeText(origin("Seattle", "SEA"), LIS_OPO)).toBe("SEA → LIS → OPO → SEA");
    expect(routeText(origin("Smallville"), [stop("Lisbon", "LIS"), stop("Braga")])).toBe(
      "Smallville → LIS → Braga → Smallville",
    );
  });

  it("is only the stops without an origin, and leaves out blank points", () => {
    expect(routeText(null, LIS_OPO)).toBe("LIS → OPO");
    expect(routeText(undefined, [stop("Lisbon", "LIS")])).toBe("LIS");
    expect(routeText(origin("Seattle", "SEA"), [stop(" ")])).toBe("");
    expect(routeText(origin(" "), LIS_OPO)).toBe("LIS → OPO");
    expect(routeText(null, [])).toBe("");
  });

  it("has a short form for trip rows", () => {
    expect(routeTextShort(origin("Seattle", "SEA"), [stop("Denver", "DEN"), stop("Aspen")])).toBe(
      "SEA → DEN",
    );
    expect(routeTextShort(null, LIS_OPO)).toBe("LIS");
    expect(routeTextShort(origin("Seattle", "SEA"), [])).toBe("SEA");
    expect(routeTextShort(null, [])).toBe("");
  });
});

describe("facts and caption", () => {
  it("writes nights and cities with their singular forms", () => {
    expect(nightsText(10)).toBe("10 nights");
    expect(nightsText(1)).toBe("1 night");
    expect(nightsText(0)).toBe("day trip");
    expect(citiesText(2)).toBe("2 cities");
    expect(citiesText(1)).toBe("1 city");
  });

  it("matches the spec: flight · 10 nights · 2 cities", () => {
    expect(tripFacts({ travelMode: "fly", nights: 10, stops: LIS_OPO })).toBe(
      "flight · 10 nights · 2 cities",
    );
    expect(tripFacts({ travelMode: "drive", nights: 1, stops: [stop("Lisbon")] })).toBe(
      "drive · 1 night · 1 city",
    );
    expect(tripFacts({ travelMode: "other", nights: 3, stops: LIS_OPO })).toBe(
      "train or other · 3 nights · 2 cities",
    );
  });

  it("claims no mode for a trip that never chose one", () => {
    expect(tripFacts({ travelMode: null, nights: 10, stops: LIS_OPO })).toBe(
      "10 nights · 2 cities",
    );
    expect(tripFacts({ nights: 10, stops: LIS_OPO })).toBe("10 nights · 2 cities");
  });

  it("builds the map caption: SEA → LIS → OPO → SEA · flight · 10 nights · 2 cities", () => {
    expect(
      routeCaption({
        origin: origin("Seattle", "SEA"),
        travelMode: "fly",
        nights: 10,
        stops: LIS_OPO,
      }),
    ).toBe("SEA → LIS → OPO → SEA · flight · 10 nights · 2 cities");
    expect(routeCaption({ nights: 10, stops: LIS_OPO })).toBe("LIS → OPO · 10 nights · 2 cities");
    expect(routeCaption({ nights: 0, stops: [] })).toBe("day trip");
  });
});

describe("withHomeOrigin (#497)", () => {
  const home = origin("Chicago", "ORD");
  it("fills a missing origin from Home, never replaces an explicit one, and never mutates", () => {
    const bare = { origin: null };
    expect(withHomeOrigin(bare, home).origin).toBe(home);
    expect(bare.origin).toBeNull();
    const own = { origin: origin("Denver") };
    expect(withHomeOrigin(own, home)).toBe(own);
    expect(withHomeOrigin<{ origin?: TripOrigin | null }>({}, home).origin).toBe(home);
    expect(withHomeOrigin(bare, null)).toBe(bare);
    expect(withHomeOrigin(bare, undefined)).toBe(bare);
  });
});
