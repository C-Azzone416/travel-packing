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

export function selectSearch(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = (...args) => fetch(...args),
): SearchFn {
  if (env.LOCATION_PROVIDER === "open-meteo") {
    return (query, { signal }) => searchOpenMeteo(query, { fetch: doFetch, signal });
  }
  return curatedSearch;
}
