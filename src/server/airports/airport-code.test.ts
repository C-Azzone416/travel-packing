import { describe, expect, it } from "vitest";
import { AIRPORT_DATA } from "./airports-data";
import { AIRPORT_RADIUS_KM, airportCodeFor, distanceKm } from "./airport-code";
import { decodeAirports } from "./build-dataset";

const airport = (
  iata: string,
  km: number,
  country = "PT",
  large = true,
  runwayFt = 8000,
  eastKm = 0,
) => ({
  iata,
  // Placed due north of the query point (38.72, -9.14) by `km`, optionally shifted east.
  latitude: 38.72 + km / 111.195,
  longitude: -9.14 + eastKm / 86.7,
  country,
  large,
  runwayFt,
});
const query = { latitude: 38.72, longitude: -9.14, countryCode: "PT" };

describe("distanceKm", () => {
  it("is zero for the same point and about right for a known pair", () => {
    expect(distanceKm(10, 20, 10, 20)).toBe(0);
    // Lisbon to Madrid is roughly 500 km.
    expect(distanceKm(38.72, -9.14, 40.42, -3.7)).toBeGreaterThan(480);
    expect(distanceKm(38.72, -9.14, 40.42, -3.7)).toBeLessThan(520);
  });
});

describe("airportCodeFor (injected airports)", () => {
  it("returns the code of the one airport in range", () => {
    expect(airportCodeFor(query, [airport("AAA", 10)])).toBe("AAA");
  });

  it("accepts a lower-case or padded country code", () => {
    expect(airportCodeFor({ ...query, countryCode: " pt " }, [airport("AAA", 10)])).toBe("AAA");
  });

  it("prefers a large airport over a nearer, longer-runway medium one", () => {
    const near = airport("MED", 5, "PT", false, 15000);
    const far = airport("BIG", 50, "PT", true, 6000);
    expect(airportCodeFor(query, [near, far])).toBe("BIG");
    expect(airportCodeFor(query, [far, near])).toBe("BIG");
  });

  it("among equals in size, prefers the longest runway, even if farther", () => {
    const short = airport("SHT", 5, "PT", true, 8000);
    const long = airport("LNG", 40, "PT", true, 12000);
    expect(airportCodeFor(query, [short, long])).toBe("LNG");
  });

  it("among equals in size and runway, prefers the nearest", () => {
    const near = airport("NER", 10, "PT", true, 9000);
    const far = airport("FAR", 30, "PT", true, 9000);
    expect(airportCodeFor(query, [far, near])).toBe("NER");
  });

  it("breaks an exact tie by code, so the answer never depends on the order of the data", () => {
    const a = airport("AAA", 10, "PT", true, 9000);
    const b = airport("BBB", 10, "PT", true, 9000);
    expect(airportCodeFor(query, [b, a])).toBe("AAA");
    expect(airportCodeFor(query, [a, b])).toBe("AAA");
  });

  it("ranks an airport with unknown runway length (0) below one with a runway", () => {
    expect(
      airportCodeFor(query, [
        airport("UNK", 5, "PT", true, 0),
        airport("RWY", 40, "PT", true, 5000),
      ]),
    ).toBe("RWY");
  });

  it("returns null when no airport is in range, and counts the radius edge", () => {
    expect(airportCodeFor(query, [airport("OUT", AIRPORT_RADIUS_KM + 2)])).toBeNull();
    expect(airportCodeFor(query, [airport("IN", AIRPORT_RADIUS_KM - 1)])).toBe("IN");
    expect(airportCodeFor(query, [])).toBeNull();
  });

  it("ignores airports in another country, however close or large", () => {
    const across = airport("ESP", 1, "ES", true, 15000);
    expect(airportCodeFor(query, [across])).toBeNull();
    expect(airportCodeFor(query, [across, airport("LOC", 50, "PT", false, 3000)])).toBe("LOC");
  });

  it("returns null for missing, non-finite or out-of-range coordinates", () => {
    const src = [airport("AAA", 10)];
    const base = { countryCode: "PT" };
    expect(airportCodeFor({ ...base }, src)).toBeNull();
    expect(airportCodeFor({ ...base, latitude: 38.72 }, src)).toBeNull();
    expect(airportCodeFor({ ...base, longitude: -9.14 }, src)).toBeNull();
    expect(airportCodeFor({ ...base, latitude: Number.NaN, longitude: -9.14 }, src)).toBeNull();
    expect(airportCodeFor({ ...base, latitude: 95, longitude: -9.14 }, src)).toBeNull();
    expect(airportCodeFor({ ...base, latitude: 38.72, longitude: 200 }, src)).toBeNull();
  });

  it("returns null for a missing or bad country code", () => {
    const where = { latitude: 38.72, longitude: -9.14 };
    for (const countryCode of [undefined, "", "P", "PRT", "1!", 7 as unknown as string]) {
      expect(airportCodeFor({ ...where, countryCode }, [airport("AAA", 10)])).toBeNull();
    }
  });
});

describe("airportCodeFor (the bundled dataset)", () => {
  it("is a real, well-formed dataset with a runway length for almost every airport", () => {
    const rows = decodeAirports(AIRPORT_DATA);
    expect(rows.length).toBeGreaterThan(2000);
    for (const entry of rows) {
      expect(entry.iata).toMatch(/^[A-Z]{3}$/);
      expect(entry.country).toMatch(/^[A-Z]{2}$/);
      expect(Number.isFinite(entry.latitude)).toBe(true);
      expect(Number.isInteger(entry.runwayFt)).toBe(true);
    }
    expect(new Set(rows.map((entry) => entry.iata)).size).toBe(rows.length);
    expect(rows.filter((entry) => entry.runwayFt > 0).length / rows.length).toBeGreaterThan(0.95);
  });

  // City-centre coordinates against the real dataset. Caroline's rule (#157): the LARGEST airport within 60 km in the
  // same country (large before medium, then longest runway, then nearest), else no airport and the caller uses the
  // country's alpha-3 (Zermatt).
  const CITIES: [string, number, number, string, string | null][] = [
    ["London", 51.51, -0.13, "GB", "LHR"],
    ["New York", 40.71, -74.01, "US", "JFK"],
    ["Paris", 48.86, 2.35, "FR", "CDG"],
    ["Tokyo", 35.68, 139.69, "JP", "HND"],
    ["Milan", 45.46, 9.19, "IT", "MXP"], // Linate is 7 km away; Malpensa has the longer runway
    ["Rome", 41.9, 12.5, "IT", "FCO"],
    ["Lisbon", 38.72, -9.14, "PT", "LIS"],
    ["Orlando", 28.54, -81.38, "US", "MCO"],
    ["Porto", 41.15, -8.61, "PT", "OPO"],
    ["Madrid", 40.42, -3.7, "ES", "MAD"],
    ["San Diego", 32.72, -117.16, "US", "SAN"],
    ["Frankfurt", 50.11, 8.68, "DE", "FRA"],
    ["Berlin", 52.52, 13.4, "DE", "BER"],
    ["Austin", 30.27, -97.74, "US", "AUS"],
    ["San Ysidro (US side of the border)", 32.55, -117.03, "US", "SAN"], // Tijuana (MX) is nearer; wrong country
    ["Zermatt", 46.02, 7.75, "CH", null], // no airport within 60 km in Switzerland
  ];

  it.each(CITIES)("%s", (_city, latitude, longitude, countryCode, expected) => {
    expect(airportCodeFor({ latitude, longitude, countryCode })).toBe(expected);
  });

  it("San Ysidro: Tijuana is nearer but in Mexico, so the Mexican stop at the same point gets Tijuana", () => {
    expect(airportCodeFor({ latitude: 32.55, longitude: -117.03, countryCode: "MX" })).toBe("TIJ");
  });
});
