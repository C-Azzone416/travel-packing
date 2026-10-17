import { describe, expect, it } from "vitest";
import { artworkFor } from "./destination-art";
import {
  customLocation,
  CUSTOM_LOCATION_ID,
  isCustomLocation,
  locationById,
  LOCATIONS,
  MAX_LOCATION_MATCHES,
  searchLocations,
} from "./locations";

describe("curated locations", () => {
  it("has about two dozen entries with unique, stable IDs and a label per entry", () => {
    expect(LOCATIONS).toHaveLength(24);
    expect(new Set(LOCATIONS.map((entry) => entry.id)).size).toBe(24);
    for (const entry of LOCATIONS) {
      expect(entry.id, entry.id).toMatch(/^[a-z]{2}(-[a-z0-9]+)+$/);
      expect(entry.label).toBe(`${entry.city}, ${entry.region}, ${entry.country}`);
      expect(entry.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("keeps both Londons, distinguishable by region and country", () => {
    const londons = LOCATIONS.filter((entry) => entry.city === "London");
    expect(londons.map((entry) => entry.id)).toEqual(["gb-eng-london", "ca-on-london"]);
    expect(londons.map((entry) => entry.label)).toEqual([
      "London, England, United Kingdom",
      "London, Ontario, Canada",
    ]);
  });

  it("includes the three entries that have their own art", () => {
    for (const id of ["us-ca-san-diego", "pt-lisbon", "gb-eng-london"]) {
      expect(locationById(id), id).not.toBeNull();
      expect(artworkFor(id).key).not.toBe("fallback");
    }
  });

  it("looks a location up by ID, or returns null", () => {
    expect(locationById("pt-lisbon")?.city).toBe("Lisbon");
    expect(locationById("nowhere")).toBeNull();
  });
});

describe("searchLocations", () => {
  it("finds both Londons, case-insensitively, and matches inside words", () => {
    expect(searchLocations("lon").map((entry) => entry.id)).toEqual([
      "gb-eng-london",
      "ca-on-london",
      "es-ct-barcelona",
    ]);
    expect(searchLocations("LONDON").map((entry) => entry.id)).toEqual([
      "gb-eng-london",
      "ca-on-london",
    ]);
  });

  it("matches on region and country too, and trims the query", () => {
    expect(searchLocations("  ontario ").map((entry) => entry.city)).toEqual(["London", "Toronto"]);
    expect(searchLocations("portugal").map((entry) => entry.id)).toEqual(["pt-lisbon"]);
  });

  it("returns nothing for a blank query or no match", () => {
    expect(searchLocations("")).toEqual([]);
    expect(searchLocations("   ")).toEqual([]);
    expect(searchLocations("zzzz")).toEqual([]);
  });

  it("caps the list at five matches", () => {
    expect(MAX_LOCATION_MATCHES).toBe(5);
    expect(searchLocations("united states")).toHaveLength(5);
  });
});

describe("custom destinations", () => {
  it("builds a custom location from the typed text, which always uses the fallback art", () => {
    const custom = customLocation("  Grandma's cabin ");
    expect(custom).toEqual({
      id: CUSTOM_LOCATION_ID,
      city: "Grandma's cabin",
      region: "",
      country: "",
      countryCode: "",
      label: "Grandma's cabin",
    });
    expect(artworkFor(custom.id).key).toBe("fallback");
  });

  it("recognizes only the custom ID", () => {
    expect(isCustomLocation(customLocation("x"))).toBe(true);
    expect(isCustomLocation(LOCATIONS[0])).toBe(false);
    expect(isCustomLocation(null)).toBe(false);
    expect(isCustomLocation(undefined)).toBe(false);
  });
});
