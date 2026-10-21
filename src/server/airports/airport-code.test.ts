import { describe, expect, it } from "vitest";
import { AIRPORT_DATA } from "./airports-data";
import { AIRPORT_RADIUS_KM, airportCodeFor, distanceKm } from "./airport-code";
import { decodeAirports } from "./build-dataset";

const airport = (iata: string, latitude: number, longitude: number, country: string) => ({
  iata,
  latitude,
  longitude,
  country,
});

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

  it("matches a city with one airport in range: Porto, Madrid and San Diego", () => {
    expect(airportCodeFor({ latitude: 41.15, longitude: -8.61, countryCode: "PT" })).toBe("OPO");
    expect(airportCodeFor({ latitude: 40.42, longitude: -3.7, countryCode: "ES" })).toBe("MAD");
    expect(airportCodeFor({ latitude: 32.72, longitude: -117.16, countryCode: "US" })).toBe("SAN");
  });

  it("keeps the city name for Lisbon: the medium airport at Cascais (CAT) counts toward ambiguity, so LIS is not 'exactly one'", () => {
    // PM decision: the strict rule stands ("never assume a city maps uniquely to one airport"), so no large-wins tweak.
    const lisbon = { latitude: 38.72, longitude: -9.14 };
    const inRange = decodeAirports(AIRPORT_DATA)
      .filter(
        (entry) =>
          entry.country === "PT" &&
          distanceKm(lisbon.latitude, lisbon.longitude, entry.latitude, entry.longitude) <=
            AIRPORT_RADIUS_KM,
      )
      .map((entry) => entry.iata)
      .sort();
    expect(inRange).toEqual(["CAT", "LIS"]);
    expect(airportCodeFor({ ...lisbon, countryCode: "PT" })).toBeNull();
  });

  it("keeps the city name for Paris and London, which have several airports in range", () => {
    expect(airportCodeFor({ latitude: 48.86, longitude: 2.35, countryCode: "FR" })).toBeNull();
    expect(airportCodeFor({ latitude: 51.51, longitude: -0.13, countryCode: "GB" })).toBeNull();
  });

  it("matches nothing for multi-airport cities: London and New York", () => {
    expect(airportCodeFor({ latitude: 51.51, longitude: -0.13, countryCode: "GB" })).toBeNull();
    expect(airportCodeFor({ latitude: 40.71, longitude: -74.01, countryCode: "US" })).toBeNull();
  });

  it("matches nothing for a small town far from any scheduled service", () => {
    expect(airportCodeFor({ latitude: 46.9, longitude: 8.0, countryCode: "CH" })).toBeNull();
    expect(airportCodeFor({ latitude: -25.0, longitude: 130.0, countryCode: "AU" })).toBeNull();
  });
});
