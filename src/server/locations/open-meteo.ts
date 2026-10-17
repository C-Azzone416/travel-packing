// Open-Meteo geocoding adapter (#47). Server-side only: the browser never calls it, and it only ever
// receives the typed query. No account or key is needed. This file never logs: a query or a place is
// personal data, so failures carry a code and nothing else.

import type { SampleLocation } from "@/domain/trip-lifecycle";

export const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const PROVIDER_NAME = "open-meteo";
export const RESULT_COUNT = 5;
export const TIMEOUT_MS = 3000;

export class LocationSearchError extends Error {
  constructor() {
    super("Location search is unavailable");
    this.name = "LocationSearchError";
  }
}

export interface OpenMeteoOptions {
  fetch: typeof fetch;
  /** Aborts the search early, e.g. when the caller's request is cancelled. */
  signal?: AbortSignal;
  timeoutMs?: number;
  baseUrl?: string;
}

interface RawPlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  country?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isRawPlace(value: unknown): value is RawPlace {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Record<string, unknown>;
  return (
    isNumber(place.id) &&
    isText(place.name) &&
    isNumber(place.latitude) &&
    isNumber(place.longitude)
  );
}

/** Two decimals is about 1 km: enough for a forecast, too coarse to find a street. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

function toLocation(place: RawPlace): SampleLocation {
  const region = isText(place.admin1) ? place.admin1 : "";
  const country = isText(place.country) ? place.country : "";
  const location: SampleLocation = {
    id: `${PROVIDER_NAME}-${place.id}`,
    city: place.name,
    region,
    country,
    countryCode: isText(place.country_code) ? place.country_code.toUpperCase() : "",
    label: [place.name, region, country].filter(Boolean).join(", "),
    provider: PROVIDER_NAME,
    providerPlaceId: String(place.id),
    latitude: round2(place.latitude),
    longitude: round2(place.longitude),
  };
  if (isText(place.timezone)) location.timezone = place.timezone;
  return location;
}

// Results that read identically ("Springfield, Illinois, United States" twice) get their next-finest
// detail so a person can tell them apart. Everything else is left alone.
function addDetail(places: RawPlace[], locations: SampleLocation[]): SampleLocation[] {
  const counts = new Map<string, number>();
  for (const location of locations)
    counts.set(location.label, (counts.get(location.label) ?? 0) + 1);
  return locations.map((location, index) => {
    const detail = places[index].admin2;
    return (counts.get(location.label) ?? 0) > 1 && isText(detail)
      ? { ...location, detail }
      : location;
  });
}

export async function searchOpenMeteo(
  query: string,
  {
    fetch: doFetch,
    signal,
    timeoutMs = TIMEOUT_MS,
    baseUrl = OPEN_METEO_GEOCODING_URL,
  }: OpenMeteoOptions,
): Promise<SampleLocation[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(RESULT_COUNT));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const timeout = AbortSignal.timeout(timeoutMs);
  let body: unknown;
  try {
    const response = await doFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new LocationSearchError();
    body = await response.json();
  } catch {
    throw new LocationSearchError();
  }

  // No match: the API omits `results` entirely. Anything else that is not a list is a bad answer.
  const results =
    typeof body === "object" && body !== null ? (body as { results?: unknown }).results : undefined;
  if (results === undefined) return [];
  if (!Array.isArray(results)) throw new LocationSearchError();
  const places = results.filter(isRawPlace).slice(0, RESULT_COUNT);
  return addDetail(places, places.map(toLocation));
}
