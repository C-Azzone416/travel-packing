import { describe, expect, it } from "vitest";
import { AIRPORT_DATA } from "./airports-data";
import { AIRPORT_RADIUS_KM, AMBIGUITY_RADIUS_KM, airportCodeFor, distanceKm } from "./airport-code";
import { decodeAirports } from "./build-dataset";

const airport = (
  iata: string,
  latitude: number,
  longitude: number,
  country: string,
  large = true,
) => ({ iata, latitude, longitude, country, large });

describe("distanceKm", () => {
  it("is zero for the same point and about right for a known pair", () => {
    expect(distanceKm(10, 20, 10, 20)).toBe(0);
    // Lisbon to Madrid is roughly 500 km.
    expect(distanceKm(38.72, -9.14, 40.42, -3.7)).toBeGreaterThan(480);
    expect(distanceKm(38.72, -9.14, 40.42, -3.7)).toBeLessThan(520);
  });
});

describe("airportCodeFor (injected airports)", () => {
  const lis = airport("LIS", 38.78, -9.13, "PT");

  it("returns the code when exactly one airport in the same country is within the radius", () => {
    expect(airportCodeFor({ latitude: 38.72, longitude: -9.14, countryCode: "PT" }, [lis])).toBe(
      "LIS",
    );
  });

  it("accepts a lower-case or padded country code", () => {
    expect(airportCodeFor({ latitude: 38.72, longitude: -9.14, countryCode: " pt " }, [lis])).toBe(
      "LIS",
    );
  });

  it("returns null when two or more airports are in range (a multi-airport city)", () => {
    const second = airport("XXX", 38.9, -9.2, "PT");
    expect(
      airportCodeFor({ latitude: 38.72, longitude: -9.14, countryCode: "PT" }, [lis, second]),
    ).toBeNull();
  });

  it("returns null when no airport is in range", () => {
    expect(
      airportCodeFor({ latitude: 41.0, longitude: -8.0, countryCode: "PT" }, [lis]),
    ).toBeNull();
  });

  it("returns null when the only airport in range is across a border", () => {
    const across = airport("ZZZ", 38.78, -9.13, "ES");
    expect(
      airportCodeFor({ latitude: 38.72, longitude: -9.14, countryCode: "PT" }, [across]),
    ).toBeNull();
  });

  it("counts an airport at the radius and not one just past it", () => {
    const north = (km: number) => airport("RRR", 38.72 + km / 111.195, -9.14, "PT");
    const query = { latitude: 38.72, longitude: -9.14, countryCode: "PT" };
    expect(airportCodeFor(query, [north(AIRPORT_RADIUS_KM - 0.5)])).toBe("RRR");
    expect(airportCodeFor(query, [north(AIRPORT_RADIUS_KM + 1)])).toBeNull();
  });

  it("returns null for missing, non-finite or out-of-range coordinates", () => {
    const base = { countryCode: "PT" };
    expect(airportCodeFor({ ...base }, [lis])).toBeNull();
    expect(airportCodeFor({ ...base, latitude: 38.72 }, [lis])).toBeNull();
    expect(airportCodeFor({ ...base, longitude: -9.14 }, [lis])).toBeNull();
    expect(airportCodeFor({ ...base, latitude: Number.NaN, longitude: -9.14 }, [lis])).toBeNull();
    expect(airportCodeFor({ ...base, latitude: 95, longitude: -9.14 }, [lis])).toBeNull();
    expect(airportCodeFor({ ...base, latitude: 38.72, longitude: 200 }, [lis])).toBeNull();
  });

  it("returns null for a missing or bad country code", () => {
    const where = { latitude: 38.72, longitude: -9.14 };
    for (const countryCode of [undefined, "", "P", "PRT", "1!", 7 as unknown as string]) {
      expect(airportCodeFor({ ...where, countryCode }, [lis])).toBeNull();
    }
  });
});

describe("the wider ambiguity ring (injected airports)", () => {
  const query = { latitude: 38.72, longitude: -9.14, countryCode: "PT" };
  const home = airport("HOM", 38.75, -9.14, "PT");
  const northKm = (km: number) => 38.72 + km / 111.195;
  const farLarge = (km: number) => airport("BIG", northKm(km), -9.14, "PT", true);
  const farMedium = (km: number) => airport("MED", northKm(km), -9.14, "PT", false);

  it("another LARGE airport inside the ring makes the stop ambiguous", () => {
    expect(airportCodeFor(query, [home, farLarge(AMBIGUITY_RADIUS_KM - 1)])).toBeNull();
  });

  it("a MEDIUM airport inside the ring does not", () => {
    expect(airportCodeFor(query, [home, farMedium(AMBIGUITY_RADIUS_KM - 1)])).toBe("HOM");
  });

  it("a large airport just past the ring does not", () => {
    expect(airportCodeFor(query, [home, farLarge(AMBIGUITY_RADIUS_KM + 2)])).toBe("HOM");
  });

  it("a large airport across the border does not, however close", () => {
    expect(airportCodeFor(query, [home, { ...farLarge(50), country: "ES" }])).toBe("HOM");
  });

  it("a medium airport inside 30 km still makes the stop ambiguous, even beside a large one", () => {
    expect(airportCodeFor(query, [home, farMedium(AIRPORT_RADIUS_KM - 5)])).toBeNull();
  });

  it("the one airport in range is never counted as its own neighbour", () => {
    expect(airportCodeFor(query, [home])).toBe("HOM");
  });
});

describe("airportCodeFor (the bundled dataset)", () => {
  it("is a real, sorted dataset of well-formed rows", () => {
    const rows = decodeAirports(AIRPORT_DATA);
    expect(rows.length).toBeGreaterThan(2000);
    for (const entry of rows) {
      expect(entry.iata).toMatch(/^[A-Z]{3}$/);
      expect(entry.country).toMatch(/^[A-Z]{2}$/);
      expect(Number.isFinite(entry.latitude)).toBe(true);
    }
    expect(new Set(rows.map((entry) => entry.iata)).size).toBe(rows.length);
  });

  // City-centre coordinates, the real dataset. PM-approved rule: exactly one airport within 30 km and no other LARGE
  // airport within 80 km ("never assume a city maps uniquely to one airport").
  const CITIES: [string, number, number, string, string | null][] = [
    ["Porto", 41.15, -8.61, "PT", "OPO"],
    ["Madrid", 40.42, -3.7, "ES", "MAD"],
    ["San Diego", 32.72, -117.16, "US", "SAN"],
    ["Frankfurt", 50.11, 8.68, "DE", "FRA"],
    ["Berlin", 52.52, 13.4, "DE", "BER"],
    ["Austin", 30.27, -97.74, "US", "AUS"],
    ["Tokyo", 35.68, 139.69, "JP", null], // HND, and Narita 64 km out
    ["Milan", 45.46, 9.19, "IT", null], // LIN, and Malpensa 41 km out
    ["Lisbon", 38.72, -9.14, "PT", null], // LIS and the medium field at Cascais (CAT, 19 km)
    ["London", 51.51, -0.13, "GB", null],
    ["Paris", 48.86, 2.35, "FR", null],
    ["New York", 40.71, -74.01, "US", null],
    ["Rome", 41.9, 12.5, "IT", null],
    ["Seoul", 37.57, 126.98, "KR", null], // GMP, and Incheon farther out
    ["Osaka", 34.69, 135.5, "JP", null], // ITM, and Kansai farther out
    ["Washington", 38.91, -77.04, "US", null], // DCA, and Dulles / Baltimore farther out
  ];

  it.each(CITIES)("%s", (_city, latitude, longitude, countryCode, expected) => {
    expect(airportCodeFor({ latitude, longitude, countryCode })).toBe(expected);
  });

  it("Lisbon's in-range set is exactly CAT and LIS (the medium field counts inside 30 km)", () => {
    const inRange = decodeAirports(AIRPORT_DATA)
      .filter(
        (entry) =>
          entry.country === "PT" &&
          distanceKm(38.72, -9.14, entry.latitude, entry.longitude) <= AIRPORT_RADIUS_KM,
      )
      .map((entry) => entry.iata)
      .sort();
    expect(inRange).toEqual(["CAT", "LIS"]);
  });

  it("matches nothing for a small town far from any scheduled service", () => {
    expect(airportCodeFor({ latitude: 46.9, longitude: 8.0, countryCode: "CH" })).toBeNull();
    expect(airportCodeFor({ latitude: -25.0, longitude: 130.0, countryCode: "AU" })).toBeNull();
  });
});
