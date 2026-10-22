// Open-Meteo geocoding adapter (#47). Server-side only: the browser never calls it, and it only ever
// receives the typed query. No account or key is needed. This file never logs: a query or a place is
// personal data, so failures carry a code and nothing else.

import type { SampleLocation } from "@/domain/trip-lifecycle";

export const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const OPEN_METEO_GET_URL = "https://geocoding-api.open-meteo.com/v1/get";
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

// A place with no country or a malformed country code is dropped here: the picker would show it without its
// "region, country" line and the data layer would refuse to save it, so it is never offered at all.
function isRawPlace(value: unknown): value is RawPlace {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Record<string, unknown>;
  return (
    isNumber(place.id) &&
    isText(place.name) &&
    isNumber(place.latitude) &&
    isNumber(place.longitude) &&
    isText(place.country) &&
    typeof place.country_code === "string" &&
    /^[A-Za-z]{2}$/.test(place.country_code)
  );
}

/** Two decimals is about 1 km: enough for a forecast, too coarse to find a street. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

function toLocation(place: RawPlace): SampleLocation {
  const region = isText(place.admin1) ? place.admin1 : "";
  const country = place.country as string;
  const location: SampleLocation = {
    id: `${PROVIDER_NAME}-${place.id}`,
    city: place.name,
    region,
    country,
    countryCode: (place.country_code as string).toUpperCase(),
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

const PLACE_ID = new RegExp(`^${PROVIDER_NAME}-(\\d{1,12})$`);

/** The provider's own numeric id from one of our place ids ("open-meteo-2643743"), or null if it isn't one. */
export function parseOpenMeteoId(id: string): string | null {
  return PLACE_ID.exec(id)?.[1] ?? null;
}

export interface OpenMeteoGetOptions extends Omit<OpenMeteoOptions, "baseUrl"> {
  /** Defaults to the real get-by-id endpoint; e2e points it at a local fake. */
  baseUrl?: string;
}

/**
 * Look one place up by its id, server-side, so what gets stored is the provider's answer and never a
 * client's claim (#47). An id that is not ours, or that the provider does not know, is null. A provider that
 * is down, slow, or answers something unexpected is an error, which the caller reports as unavailable.
 */
export async function getOpenMeteoPlace(
  id: string,
  {
    fetch: doFetch,
    signal,
    timeoutMs = TIMEOUT_MS,
    baseUrl = OPEN_METEO_GET_URL,
  }: OpenMeteoGetOptions,
): Promise<SampleLocation | null> {
  const providerId = parseOpenMeteoId(id);
  if (providerId === null) return null;
  const url = new URL(baseUrl);
  url.searchParams.set("id", providerId);
  url.searchParams.set("language", "en");

  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  let body: unknown;
  try {
    response = await doFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    // The API answers an unknown id with a client error; that is "no such place", not an outage.
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new LocationSearchError();
    body = await response.json();
  } catch {
    throw new LocationSearchError();
  }
  if (!isRawPlace(body) || String(body.id) !== providerId) throw new LocationSearchError();
  return toLocation(body);
}
