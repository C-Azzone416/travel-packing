// Turns a place id the browser sent into the canonical place, server-side (#47). The browser's claim is
// only ever an id: the city, region, coordinates and timezone that get stored come from here, so they can
// never be forged or silently wrong.

import { locationById } from "@/domain/locations";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import { geocodingGetUrl } from "./provider-config";
import { getOpenMeteoPlace, parseOpenMeteoId } from "./open-meteo";

/** Resolves to the canonical place, null when the id is not a place we know, and rejects when the provider is down. */
export type LocationResolver = (
  id: string,
  options?: { signal?: AbortSignal },
) => Promise<SampleLocation | null>;

/** The curated list only: no network. Provider ids never resolve, so a trip can't carry one nobody can check. */
export const curatedResolver: LocationResolver = async (id) => locationById(id);

export function selectResolver(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = (...args) => fetch(...args),
): LocationResolver {
  // Same exact-value rule as the search: only "open-meteo" turns the provider on.
  if (env.LOCATION_PROVIDER !== "open-meteo") return curatedResolver;
  const baseUrl = geocodingGetUrl(env);
  return async (id, { signal } = {}) =>
    parseOpenMeteoId(id) === null
      ? locationById(id)
      : getOpenMeteoPlace(id, { fetch: doFetch, signal, baseUrl });
}
