import { describe, expect, it } from "vitest";
import type { SampleLocation } from "../../domain/trip-stops";
import { normalisePlace, placeFromValues, placeToValues } from "./place-columns";

const curated: SampleLocation = {
  id: "paris",
  city: "Paris",
  region: "Ile-de-France",
  country: "France",
  countryCode: "FR",
  label: "Paris, Ile-de-France, France",
};
const lisbon: SampleLocation = {
  ...curated,
  id: "lisbon",
  city: "Lisbon",
  countryCode: "PT",
  provider: "open-meteo",
  providerPlaceId: "p1",
  latitude: 38.72252,
  longitude: -9.13934,
  timezone: "Europe/Lisbon",
};

describe("placeToValues", () => {
  it("is all null for no place", () => {
    expect(Object.values(placeToValues(null)).every((value) => value === null)).toBe(true);
  });

  it("rounds coordinates to 2 decimals (about 1 km) before they can be stored", () => {
    expect(placeToValues(lisbon)).toMatchObject({ latitude: "38.72", longitude: "-9.14" });
    expect(placeToValues({ ...lisbon, latitude: 0.005, longitude: 179.994 })).toMatchObject({
      latitude: "0.01",
      longitude: "179.99",
    });
  });

  it("keeps provider fields, coordinates and timezone only for a provider place", () => {
    expect(placeToValues(lisbon)).toMatchObject({
      provider: "open-meteo",
      placeId: "p1",
      timezone: "Europe/Lisbon",
    });
    // Coordinates or a timezone on a curated place, or a provider without its place id, are dropped.
    const stray = { ...curated, latitude: 1.234, longitude: 2.345, timezone: "Etc/UTC" };
    expect(placeToValues(stray)).toMatchObject({
      provider: null,
      placeId: null,
      latitude: null,
      longitude: null,
      timezone: null,
    });
    expect(placeToValues({ ...curated, provider: "open-meteo" })).toMatchObject({
      provider: null,
      placeId: null,
    });
    // A provider place without coordinates stores none.
    expect(placeToValues({ ...lisbon, latitude: undefined })).toMatchObject({
      latitude: null,
      longitude: null,
    });
  });

  it("stores an empty id, label, region, country or code as null", () => {
    expect(
      placeToValues({
        id: "",
        city: "Anywhere",
        region: "",
        country: "",
        countryCode: "",
        label: "",
      }),
    ).toEqual({
      city: "Anywhere",
      locationId: null,
      locationLabel: null,
      provider: null,
      placeId: null,
      region: null,
      country: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      timezone: null,
    });
  });
});

describe("placeFromValues", () => {
  it("is null without a city", () => {
    expect(placeFromValues(placeToValues(null))).toBeNull();
  });

  it("round-trips a place and derives (never stores) the airport code", () => {
    const back = placeFromValues(placeToValues(lisbon));
    expect(back?.airportCode).toBe("LIS");
    expect(back?.location).toMatchObject({
      id: "lisbon",
      city: "Lisbon",
      provider: "open-meteo",
      providerPlaceId: "p1",
      latitude: 38.72,
      longitude: -9.14,
      timezone: "Europe/Lisbon",
    });
  });

  it("fills in what a curated place lacks: no provider, no airport, label falls back to the city", () => {
    const back = placeFromValues({ ...placeToValues(curated), locationLabel: null });
    expect(back?.airportCode).toBeUndefined();
    expect(back?.location).toEqual({
      id: "paris",
      city: "Paris",
      region: "Ile-de-France",
      country: "France",
      countryCode: "FR",
      label: "Paris",
    });
    const bare = placeFromValues({ ...placeToValues(null), city: "Nowhere" });
    expect(bare?.location).toEqual({
      id: "",
      city: "Nowhere",
      region: "",
      country: "",
      countryCode: "",
      label: "Nowhere",
    });
  });

  it("restores a provider place without coordinates or timezone", () => {
    const values = { ...placeToValues(lisbon), latitude: null, longitude: null, timezone: null };
    const back = placeFromValues(values)?.location;
    expect(back?.provider).toBe("open-meteo");
    expect(back?.latitude).toBeUndefined();
    expect(back?.timezone).toBeUndefined();
  });
});

describe("normalisePlace", () => {
  it("is what storing and reading back would give", () => {
    expect(normalisePlace(lisbon)).toEqual(placeFromValues(placeToValues(lisbon)));
    expect(normalisePlace(lisbon).location.latitude).toBe(38.72);
  });
});
