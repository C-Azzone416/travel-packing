export interface DestinationArtwork {
  /** Stable key for tests and styling hooks. */
  key: string;
  /** Public URL of the original illustration. */
  src: string;
}

// Adding art is a data change only (#32): drop one image in public/destinations,
// add one entry here, and add a row to docs/ART_SOURCES.md in the same PR.
// Keys are location IDs. Artwork is decorative, so there is deliberately no
// label or caption field that could leak into the UI.
export const DESTINATION_ART: Readonly<Record<string, DestinationArtwork>> = {
  "us-ca-san-diego": { key: "san-diego", src: "/destinations/destination-san-diego.jpg" },
  "pt-lisbon": { key: "lisbon", src: "/destinations/destination-lisbon.jpg" },
  "gb-eng-london": { key: "london", src: "/destinations/destination-london.jpg" },
};

export const FALLBACK_ART: DestinationArtwork = {
  key: "fallback",
  src: "/destinations/destination-fallback.jpg",
};

// Unknown, custom (typed) and missing destinations all get the neutral fallback.
// Own-property check so IDs like "constructor" can never hit Object.prototype.
export function artworkFor(locationId: string | null | undefined): DestinationArtwork {
  if (locationId && Object.hasOwn(DESTINATION_ART, locationId)) return DESTINATION_ART[locationId];
  return FALLBACK_ART;
}
