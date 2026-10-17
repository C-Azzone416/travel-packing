// The browser's LocationProvider (#47). It only ever calls this app's own owner-only endpoint, which
// holds the real provider server-side; the browser never contacts a geocoding service, and only the
// typed text leaves the page.

import type { LocationProvider } from "@/domain/location-provider";
import type { SampleLocation } from "@/domain/trip-lifecycle";

export const SEARCH_PATH = "/api/locations/search";
export const SEARCH_ATTRIBUTION = "Place search is provided by Open-Meteo.";

const text = (value: unknown): value is string => typeof value === "string";

function isPlace(value: unknown): value is SampleLocation {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Record<string, unknown>;
  return (
    ["id", "city", "region", "country", "countryCode", "label"].every((key) => text(place[key])) &&
    place.id !== ""
  );
}

export interface ApiProviderOptions {
  fetch?: typeof fetch;
}

export function createApiLocationProvider({
  fetch: doFetch = (...args) => fetch(...args),
}: ApiProviderOptions = {}): LocationProvider {
  return {
    minQueryLength: 2,
    debounceMs: 300,
    attribution: SEARCH_ATTRIBUTION,
    async search(query, { signal }) {
      const response = await doFetch(`${SEARCH_PATH}?q=${encodeURIComponent(query)}`, {
        signal,
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("search failed");
      const body: unknown = await response.json();
      const places =
        typeof body === "object" && body !== null
          ? (body as { places?: unknown }).places
          : undefined;
      if (!Array.isArray(places) || !places.every(isPlace)) throw new Error("bad search response");
      return places;
    },
  };
}
