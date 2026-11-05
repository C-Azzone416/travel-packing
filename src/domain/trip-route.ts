// A trip's origin, travel mode and name (#379, epic #375): the display helpers for the route caption, the trip's
// name, and the facts line ("flight · 10 nights · 2 cities"). Pure data and helpers; no framework imports.
//
// Where a place has a known airport the route uses its three-letter code (as the stamps do, src/domain/stamps.ts);
// otherwise it uses the city name. A code is never invented.

import type { SampleLocation, TripStop } from "./trip-stops";

export const TRAVEL_MODES = ["fly", "drive", "other"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** Longest trip name. Shorter than an item name because it is a heading on the Home hero and the trip rows. */
export const MAX_TRIP_NAME_LENGTH = 60;

/** The words in the facts line and route caption (design spec #376, caption "<HOME> → LIS → OPO → <HOME> · flight · 10 nights · 2 cities"). */
export const TRAVEL_MODE_CAPTION: Record<TravelMode, string> = {
  fly: "flight",
  drive: "drive",
  other: "train or other",
};

/** The "Getting there" segmented control labels (design spec #376). */
export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  fly: "Fly",
  drive: "Drive",
  other: "Train or other",
};

/** A place a trip starts from (and returns to): a stop's place shape, plus the airport code the server derived. */
export interface TripOrigin {
  location: SampleLocation;
  /** IATA code of the largest airport within 60 km (same derivation as a stop's). Derived on the server, never stored. */
  airportCode?: string;
}

/** A typed trip name made ready to store: trimmed; blank means "no name" (null). Length is checked by the caller's schema. */
export function normaliseTripName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim();
  return name === "" ? null : name;
}

/** The distinct cities of a route in order, compared case-insensitively ("Lisbon, Porto, Lisbon" has two). */
export function distinctCities(stops: readonly TripStop[]): string[] {
  const seen = new Set<string>();
  const cities: string[] = [];
  for (const stop of stops) {
    const city = stop.location.city.trim();
    const key = city.toLowerCase();
    if (city === "" || seen.has(key)) continue;
    seen.add(key);
    cities.push(city);
  }
  return cities;
}

/** "Lisbon", "Lisbon & Porto", "Lisbon, Porto & Madrid". */
export function joinCities(cities: readonly string[]): string {
  if (cities.length <= 1) return cities[0] ?? "";
  return `${cities.slice(0, -1).join(", ")} & ${cities[cities.length - 1]}`;
}

/** What a trip is called on screen: the owner's name, else its stops joined ("Lisbon & Porto"), else the stored destination. */
export function tripDisplayName(trip: {
  name?: string | null;
  stops: readonly TripStop[];
  destination?: string;
}): string {
  return (
    normaliseTripName(trip.name) ??
    (joinCities(distinctCities(trip.stops)) || (trip.destination ?? "").trim())
  );
}

const CODE = /^[A-Z]{3}$/;

/** One point of the route: its airport code when it has one, else the city name. */
export function routePointLabel(point: {
  airportCode?: string;
  location: Pick<SampleLocation, "city">;
}): string {
  return point.airportCode && CODE.test(point.airportCode)
    ? point.airportCode
    : point.location.city.trim();
}

/**
 * "SEA → LIS → OPO → SEA": from the origin, through each stop, and home again. Without an origin only the stops
 * ("LIS → OPO"): there is nowhere to return to. A stop with no usable label (a blank city) is left out; no stops, no route.
 */
export function routeText(
  origin: TripOrigin | null | undefined,
  stops: readonly TripStop[],
): string {
  const middle = stops.map(routePointLabel).filter((label) => label !== "");
  if (middle.length === 0) return "";
  const home = origin ? routePointLabel(origin) : "";
  const labels = home === "" ? middle : [home, ...middle, home];
  return labels.join(" → ");
}

/** The short form for a trip row: "SEA → DEN" (origin and first stop), or just the first stop without an origin. */
export function routeTextShort(
  origin: TripOrigin | null | undefined,
  stops: readonly TripStop[],
): string {
  const first = stops[0] ? routePointLabel(stops[0]) : "";
  const home = origin ? routePointLabel(origin) : "";
  return [home, first].filter((label) => label !== "").join(" → ");
}

/** "10 nights", "1 night", "day trip" (a same-day trip has none). */
export function nightsText(nights: number): string {
  if (nights <= 0) return "day trip";
  return nights === 1 ? "1 night" : `${nights} nights`;
}

export function citiesText(count: number): string {
  return count === 1 ? "1 city" : `${count} cities`;
}

/**
 * "flight · 10 nights · 2 cities". The mode is left out when the trip never chose one (existing trips), so nothing is
 * claimed: "10 nights · 2 cities".
 */
export function tripFacts(trip: {
  travelMode?: TravelMode | null;
  nights: number;
  stops: readonly TripStop[];
}): string {
  return [
    trip.travelMode ? TRAVEL_MODE_CAPTION[trip.travelMode] : "",
    nightsText(trip.nights),
    citiesText(distinctCities(trip.stops).length),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The map caption: "SEA → LIS → OPO → SEA · flight · 10 nights · 2 cities". */
export function routeCaption(trip: {
  origin?: TripOrigin | null;
  travelMode?: TravelMode | null;
  nights: number;
  stops: readonly TripStop[];
}): string {
  return [routeText(trip.origin, trip.stops), tripFacts(trip)]
    .filter((part) => part !== "")
    .join(" · ");
}
