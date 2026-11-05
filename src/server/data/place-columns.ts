// The optional city-level place stored as flat columns on users (home_*) and trips (origin_*) (#379). One mapping in each
// direction, so the two cannot drift from each other or from how stops store a place (trip-store.ts stopValues/toStop):
// provider fields and coordinates exist only for a provider place, coordinates are re-rounded to 2 decimals (about 1 km)
// on the way in, and the airport code is derived on the way out and never stored.

import type { TripOrigin } from "../../domain/trip-route";
import type { SampleLocation } from "../../domain/trip-stops";
import { airportCodeFor } from "../airports/airport-code";
import type * as schema from "../db/schema";

/** The values of the eleven place columns, in column-neutral names. All null = no place. */
export interface PlaceValues {
  city: string | null;
  locationId: string | null;
  locationLabel: string | null;
  provider: string | null;
  placeId: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
}

const orNull = (value: string): string | null => (value === "" ? null : value);
const round2 = (value: number): string => String(Math.round(value * 100) / 100);

export function placeToValues(place: SampleLocation | null): PlaceValues {
  if (!place) {
    return {
      city: null,
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
    };
  }
  const fromProvider = place.provider !== undefined && place.providerPlaceId !== undefined;
  const hasCoordinates =
    fromProvider && place.latitude !== undefined && place.longitude !== undefined;
  return {
    city: place.city,
    locationId: orNull(place.id),
    locationLabel: orNull(place.label),
    provider: fromProvider ? (place.provider ?? null) : null,
    placeId: fromProvider ? (place.providerPlaceId ?? null) : null,
    region: orNull(place.region),
    country: orNull(place.country),
    countryCode: orNull(place.countryCode),
    latitude: hasCoordinates ? round2(place.latitude as number) : null,
    longitude: hasCoordinates ? round2(place.longitude as number) : null,
    timezone: fromProvider ? (place.timezone ?? null) : null,
  };
}

/** The place back as a TripOrigin (with the derived airport code), or null when no city is stored. */
export function placeFromValues(values: PlaceValues): TripOrigin | null {
  if (values.city === null) return null;
  const location: SampleLocation = {
    id: values.locationId ?? "",
    city: values.city,
    region: values.region ?? "",
    country: values.country ?? "",
    countryCode: values.countryCode ?? "",
    label: values.locationLabel ?? values.city,
  };
  if (values.provider !== null && values.placeId !== null) {
    location.provider = values.provider;
    location.providerPlaceId = values.placeId;
    if (values.latitude !== null && values.longitude !== null) {
      location.latitude = Number(values.latitude);
      location.longitude = Number(values.longitude);
    }
    if (values.timezone !== null) location.timezone = values.timezone;
  }
  const airportCode = airportCodeFor({
    latitude: location.latitude,
    longitude: location.longitude,
    countryCode: location.countryCode,
  });
  return { location, ...(airportCode ? { airportCode } : {}) };
}

/** A resolved place as it will be stored and read back: coordinates rounded, provider fields only for a provider place, airport code derived. */
export function normalisePlace(place: SampleLocation): TripOrigin {
  return placeFromValues(placeToValues(place)) as TripOrigin;
}

type UserRow = typeof schema.users.$inferSelect;
type TripRow = typeof schema.trips.$inferSelect;

export function homeToColumns(place: SampleLocation | null) {
  const v = placeToValues(place);
  return {
    homeCity: v.city,
    homeLocationId: v.locationId,
    homeLocationLabel: v.locationLabel,
    homeLocationProvider: v.provider,
    homeLocationPlaceId: v.placeId,
    homeLocationRegion: v.region,
    homeLocationCountry: v.country,
    homeLocationCountryCode: v.countryCode,
    homeLatitude: v.latitude,
    homeLongitude: v.longitude,
    homeTimezone: v.timezone,
  };
}

export function homeFromRow(row: UserRow): TripOrigin | null {
  return placeFromValues({
    city: row.homeCity,
    locationId: row.homeLocationId,
    locationLabel: row.homeLocationLabel,
    provider: row.homeLocationProvider,
    placeId: row.homeLocationPlaceId,
    region: row.homeLocationRegion,
    country: row.homeLocationCountry,
    countryCode: row.homeLocationCountryCode,
    latitude: row.homeLatitude,
    longitude: row.homeLongitude,
    timezone: row.homeTimezone,
  });
}

export function originToColumns(place: SampleLocation | null) {
  const v = placeToValues(place);
  return {
    originCity: v.city,
    originLocationId: v.locationId,
    originLocationLabel: v.locationLabel,
    originLocationProvider: v.provider,
    originLocationPlaceId: v.placeId,
    originLocationRegion: v.region,
    originLocationCountry: v.country,
    originLocationCountryCode: v.countryCode,
    originLatitude: v.latitude,
    originLongitude: v.longitude,
    originTimezone: v.timezone,
  };
}

export function originFromRow(row: TripRow): TripOrigin | null {
  return placeFromValues({
    city: row.originCity,
    locationId: row.originLocationId,
    locationLabel: row.originLocationLabel,
    provider: row.originLocationProvider,
    placeId: row.originLocationPlaceId,
    region: row.originLocationRegion,
    country: row.originLocationCountry,
    countryCode: row.originLocationCountryCode,
    latitude: row.originLatitude,
    longitude: row.originLongitude,
    timezone: row.originTimezone,
  });
}
