// Curated local destination list (#32). Stable IDs ("us-ca-san-diego" style) so a provider
// can be mapped to them later (#33). Only some entries have their own art; the rest use the
// neutral fallback (src/domain/destination-art.ts). No network, no geocoding.

import type { SampleLocation } from "./trip-lifecycle";

type Entry = [id: string, city: string, region: string, country: string, countryCode: string];

const ENTRIES: readonly Entry[] = [
  ["us-ca-palm-springs", "Palm Springs", "California", "United States", "US"],
  ["gb-eng-london", "London", "England", "United Kingdom", "GB"],
  ["ca-on-london", "London", "Ontario", "Canada", "CA"],
  ["us-ca-santa-barbara", "Santa Barbara", "California", "United States", "US"],
  ["us-ca-san-diego", "San Diego", "California", "United States", "US"],
  ["pt-lisbon", "Lisbon", "Lisbon District", "Portugal", "PT"],
  ["fr-idf-paris", "Paris", "Île-de-France", "France", "FR"],
  // Starter additions proposed by design (#32). Pending Caroline's confirmation of the list.
  ["us-hi-honolulu", "Honolulu", "Hawaii", "United States", "US"],
  ["us-ny-new-york", "New York", "New York", "United States", "US"],
  ["us-il-chicago", "Chicago", "Illinois", "United States", "US"],
  ["us-wa-seattle", "Seattle", "Washington", "United States", "US"],
  ["us-co-denver", "Denver", "Colorado", "United States", "US"],
  ["us-tx-austin", "Austin", "Texas", "United States", "US"],
  ["us-tn-nashville", "Nashville", "Tennessee", "United States", "US"],
  ["mx-cmx-mexico-city", "Mexico City", "Mexico City", "Mexico", "MX"],
  ["mx-roo-cancun", "Cancún", "Quintana Roo", "Mexico", "MX"],
  ["ca-on-toronto", "Toronto", "Ontario", "Canada", "CA"],
  ["ca-bc-vancouver", "Vancouver", "British Columbia", "Canada", "CA"],
  ["it-lazio-rome", "Rome", "Lazio", "Italy", "IT"],
  ["es-ct-barcelona", "Barcelona", "Catalonia", "Spain", "ES"],
  ["nl-nh-amsterdam", "Amsterdam", "North Holland", "Netherlands", "NL"],
  ["jp-13-tokyo", "Tokyo", "Tokyo", "Japan", "JP"],
  ["au-nsw-sydney", "Sydney", "New South Wales", "Australia", "AU"],
  ["ie-l-dublin", "Dublin", "Leinster", "Ireland", "IE"],
];

export const LOCATIONS: readonly SampleLocation[] = ENTRIES.map(
  ([id, city, region, country, countryCode]) => ({
    id,
    city,
    region,
    country,
    countryCode,
    label: `${city}, ${region}, ${country}`,
  }),
);

export const MAX_LOCATION_MATCHES = 5;

export function locationById(id: string): SampleLocation | null {
  return LOCATIONS.find((entry) => entry.id === id) ?? null;
}

// Case-insensitive substring match over "City, Region, Country". Blank queries match nothing.
export function searchLocations(query: string): SampleLocation[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return LOCATIONS.filter((entry) => entry.label.toLowerCase().includes(needle)).slice(
    0,
    MAX_LOCATION_MATCHES,
  );
}

/** Id of a location the user typed themselves (only offered while the Custom row is enabled). */
export const CUSTOM_LOCATION_ID = "custom";

export function customLocation(text: string): SampleLocation {
  const label = text.trim();
  return { id: CUSTOM_LOCATION_ID, city: label, region: "", country: "", countryCode: "", label };
}

export function isCustomLocation(location: Pick<SampleLocation, "id"> | null | undefined): boolean {
  return location?.id === CUSTOM_LOCATION_ID;
}
