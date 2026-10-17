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

/** The get-by-id sibling of the (e2e-only) search override: the same host, `/get` instead of `/search`. */
export function geocodingGetUrl(env: Record<string, string | undefined>): string | undefined {
  return geocodingBaseUrl(env)?.replace(/\/search$/, "/get");
}

/** The one place that decides whether the real provider is on: only the exact value "open-meteo". */
export const providerEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  env.LOCATION_PROVIDER === "open-meteo";

export function selectSearch(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = (...args) => fetch(...args),
): SearchFn {
  if (providerEnabled(env)) {
    const baseUrl = geocodingBaseUrl(env);
    return (query, { signal }) => searchOpenMeteo(query, { fetch: doFetch, signal, baseUrl });
  }
  return curatedSearch;
}
