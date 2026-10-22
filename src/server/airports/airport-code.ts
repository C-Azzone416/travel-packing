// The airport code for a stop's stamp (#157, replacing #152's "exactly one" rule). Every city stamp is three letters, so
// when several airports serve a city the LARGEST wins, never an invented code:
//   candidates: qualifying airports (large or medium, IATA code, scheduled service) in the stop's own country within
//   AIRPORT_RADIUS_KM (60) of its stored coordinates;
//   ranking: large before medium, then the longest runway, then the nearest, then the code (so the answer is stable).
// No candidate, or missing coordinates or country, means no airport code and the caller uses the country's alpha-3.
// Pure and deterministic; no network.

import { AIRPORT_DATA } from "./airports-data";
import { decodeAirports, type AirportRow } from "./build-dataset";

/** How far from the stop an airport may be to count as serving it. */
export const AIRPORT_RADIUS_KM = 60;

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
  const candidates = source
    .filter((airport) => airport.country === country)
    .map((airport) => ({
      airport,
      km: distanceKm(latitude, longitude, airport.latitude, airport.longitude),
    }))
    .filter((entry) => entry.km <= AIRPORT_RADIUS_KM)
    .sort(
      (a, b) =>
        Number(b.airport.large) - Number(a.airport.large) ||
        b.airport.runwayFt - a.airport.runwayFt ||
        a.km - b.km ||
        a.airport.iata.localeCompare(b.airport.iata),
    );
  return candidates[0]?.airport.iata ?? null;
}
