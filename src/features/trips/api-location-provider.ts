// The browser's LocationProvider (#47). It only ever calls this app's own owner-only endpoint, which
// holds the real provider server-side; the browser never contacts a geocoding service, and only the
// typed text leaves the page.

import type { CreditPart } from "@/components/ui/Credit";
import type { LocationProvider } from "@/domain/location-provider";
import type { SampleLocation } from "@/domain/trip-lifecycle";

export const SEARCH_PATH = "/api/locations/search";
// Open-Meteo's licence (CC BY 4.0) asks for a link to open-meteo.com next to its data, and its geocoding data
// comes from GeoNames (also CC BY 4.0).
export const SEARCH_ATTRIBUTION: readonly CreditPart[] = [
  "Place search by ",
  { text: "Open-Meteo.com", href: "https://open-meteo.com/" },
  ", location data from ",
  { text: "GeoNames", href: "https://www.geonames.org/" },
  ".",
];

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
  /** The server is using the real provider, so its credit is shown. Curated answers need no credit. */
  credited?: boolean;
}

export function createApiLocationProvider({
  fetch: doFetch = (...args) => fetch(...args),
  credited = false,
}: ApiProviderOptions = {}): LocationProvider {
  return {
    minQueryLength: 2,
    debounceMs: 300,
    ...(credited ? { attribution: SEARCH_ATTRIBUTION } : {}),
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
