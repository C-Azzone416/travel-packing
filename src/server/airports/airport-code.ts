// The airport code for a stop's stamp (#152). Reliable or nothing: a code is returned only when exactly one
// qualifying airport lies within AIRPORT_RADIUS_KM of the stop's stored coordinates and in the stop's own country.
// Two or more (London, New York), none, or missing coordinates/country all mean "no code" and the stamp keeps the
// city name. Pure and deterministic; no network.

import { AIRPORT_DATA } from "./airports-data";
import { decodeAirports, type AirportRow } from "./build-dataset";

/** How far from the stop an airport may be to count as serving it. */
export const AIRPORT_RADIUS_KM = 30;

export interface AirportQuery {
  latitude?: number;
  longitude?: number;
  /** ISO 3166-1 alpha-2, as stored. */
  countryCode?: string;
}

let dataset: AirportRow[] | null = null;
const airports = () => (dataset ??= decodeAirports(AIRPORT_DATA));

const EARTH_RADIUS_KM = 6371;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function airportCodeFor(
  query: AirportQuery,
  source: readonly AirportRow[] = airports(),
): string | null {
  const { latitude, longitude } = query;
  const country =
    typeof query.countryCode === "string" ? query.countryCode.trim().toUpperCase() : "";
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (!/^[A-Z]{2}$/.test(country)) return null;
  const near = source.filter(
    (airport) =>
      airport.country === country &&
      distanceKm(latitude, longitude, airport.latitude, airport.longitude) <= AIRPORT_RADIUS_KM,
  );
  return near.length === 1 ? near[0].iata : null;
}
