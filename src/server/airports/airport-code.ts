// The airport code for a stop's stamp (#152). Reliable or nothing, in two steps, both within the stop's own country:
//   1. Exactly one qualifying airport (large or medium, IATA code, scheduled service) lies within
//      AIRPORT_RADIUS_KM (30) of the stop's stored coordinates. Two or more (London, New York) or none means no code.
//   2. No OTHER large airport lies within AMBIGUITY_RADIUS_KM (80). A city served by a second big airport farther out
//      (Tokyo's Narita, Milan's Malpensa) is not unique to one airport. Medium regional fields in that ring (Mannheim
//      near Frankfurt, Carlsbad near San Diego) do not make a city ambiguous, so only LARGE airports count here.
// Missing coordinates or country mean no code, and no code means the stamp keeps the city name. Pure and deterministic;
// no network.

import { AIRPORT_DATA } from "./airports-data";
import { decodeAirports, type AirportRow } from "./build-dataset";

/** How far from the stop an airport may be to count as serving it. */
export const AIRPORT_RADIUS_KM = 30;

/** How far another LARGE airport may be before the stop stops counting as served by just one. */
export const AMBIGUITY_RADIUS_KM = 80;

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
  const sameCountry = source.filter((airport) => airport.country === country);
  const distance = (airport: AirportRow) =>
    distanceKm(latitude, longitude, airport.latitude, airport.longitude);
  const near = sameCountry.filter((airport) => distance(airport) <= AIRPORT_RADIUS_KM);
  if (near.length !== 1) return null;
  const otherLarge = sameCountry.some(
    (airport) =>
      airport.large && airport.iata !== near[0].iata && distance(airport) <= AMBIGUITY_RADIUS_KM,
  );
  return otherLarge ? null : near[0].iata;
}
