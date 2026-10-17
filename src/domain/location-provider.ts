// The destination picker talks to places only through this interface, so a real geocoding
// adapter (#47) can replace the curated list without any UI change. Adapters never get more
// than the typed query, and the picker never falls back to free text if one fails.

import { searchLocations } from "./locations";
import type { SampleLocation } from "./trip-lifecycle";

export interface LocationProvider {
  /** Queries shorter than this (after trimming) never reach the provider. */
  minQueryLength: number;
  /** Quiet period after typing stops before a search starts. */
  debounceMs: number;
  /** Rejects when the provider is unavailable. `signal` aborts a search the user has moved on from. */
  search(query: string, options: { signal: AbortSignal }): Promise<SampleLocation[]>;
}

/** The curated local list (#32): instant, offline, and the test/dev adapter. */
export const curatedLocationProvider: LocationProvider = {
  minQueryLength: 1,
  debounceMs: 0,
  search: async (query) => searchLocations(query),
};
