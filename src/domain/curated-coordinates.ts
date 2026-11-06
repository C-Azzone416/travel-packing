// Where the curated destinations (src/domain/locations.ts) are, to the nearest hundredth of a degree: the route map
// needs a point for every stop, and a curated place has no coordinates of its own (only provider places do, #47).
// Public geography, no network. A place that is not here simply has no point on the map: never guessed.

export interface Coordinates {
  lat: number;
  lng: number;
}

const COORDINATES: Readonly<Record<string, Coordinates>> = {
  "us-ca-palm-springs": { lat: 33.83, lng: -116.55 },
  "gb-eng-london": { lat: 51.51, lng: -0.13 },
  "ca-on-london": { lat: 42.98, lng: -81.25 },
  "us-ca-santa-barbara": { lat: 34.42, lng: -119.7 },
  "us-ca-san-diego": { lat: 32.72, lng: -117.16 },
  "pt-lisbon": { lat: 38.72, lng: -9.14 },
  "fr-idf-paris": { lat: 48.86, lng: 2.35 },
  "us-hi-honolulu": { lat: 21.31, lng: -157.86 },
  "us-ny-new-york": { lat: 40.71, lng: -74.01 },
  "us-il-chicago": { lat: 41.88, lng: -87.63 },
  "us-wa-seattle": { lat: 47.61, lng: -122.33 },
  "us-co-denver": { lat: 39.74, lng: -104.99 },
  "us-tx-austin": { lat: 30.27, lng: -97.74 },
  "us-tn-nashville": { lat: 36.16, lng: -86.78 },
  "mx-cmx-mexico-city": { lat: 19.43, lng: -99.13 },
  "mx-roo-cancun": { lat: 21.16, lng: -86.85 },
  "ca-on-toronto": { lat: 43.65, lng: -79.38 },
  "ca-bc-vancouver": { lat: 49.28, lng: -123.12 },
  "it-lazio-rome": { lat: 41.9, lng: 12.5 },
  "es-ct-barcelona": { lat: 41.39, lng: 2.17 },
  "nl-nh-amsterdam": { lat: 52.37, lng: 4.9 },
  "jp-13-tokyo": { lat: 35.68, lng: 139.69 },
  "au-nsw-sydney": { lat: -33.87, lng: 151.21 },
  "ie-l-dublin": { lat: 53.35, lng: -6.26 },
};

/** The point for a curated place id, or null for any other id. */
export function curatedCoordinates(locationId: string): Coordinates | null {
  return Object.prototype.hasOwnProperty.call(COORDINATES, locationId)
    ? COORDINATES[locationId]
    : null;
}
