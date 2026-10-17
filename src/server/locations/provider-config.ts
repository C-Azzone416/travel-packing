// Which geocoding source the server uses (#47). Fails safe: anything other than an explicit
// "open-meteo" uses the curated list, so no destination text leaves the server until it is turned on.

import { searchLocations } from "@/domain/locations";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import { searchOpenMeteo } from "./open-meteo";

export type SearchFn = (
  query: string,
  options: { signal?: AbortSignal },
) => Promise<SampleLocation[]>;

export const curatedSearch: SearchFn = async (query) => searchLocations(query);

// e2e only: lets the test server point at a local fake instead of the real geocoder. It is honored
// only in an e2e build (NEXT_PUBLIC_E2E_BUILD=1, which no deployed build sets) and never on Vercel, so
// production can never be redirected by an environment variable.
export function geocodingBaseUrl(env: Record<string, string | undefined>): string | undefined {
  const override = env.OPEN_METEO_GEOCODING_URL;
  if (!override || env.NEXT_PUBLIC_E2E_BUILD !== "1" || env.VERCEL) return undefined;
  return override;
}

export function selectSearch(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = (...args) => fetch(...args),
): SearchFn {
  if (env.LOCATION_PROVIDER === "open-meteo") {
    const baseUrl = geocodingBaseUrl(env);
    return (query, { signal }) => searchOpenMeteo(query, { fetch: doFetch, signal, baseUrl });
  }
  return curatedSearch;
}
