// A trip's origin, travel mode and name (#379, epic #375): the display helpers for the route caption, the trip's
// name, and the facts line ("flight · 10 nights · 2 cities"). Pure data and helpers; no framework imports.
//
// Where a place has a known airport the route uses its three-letter code (as the stamps do, src/domain/stamps.ts);
// otherwise it uses the city name. A code is never invented.

import { curatedCoordinates } from "./curated-coordinates";
import type { RoutePoint } from "./route-map/geometry";
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
  const cities = distinctCities(trip.stops).length;
  return [
    trip.travelMode ? TRAVEL_MODE_CAPTION[trip.travelMode] : "",
    nightsText(trip.nights),
    // A trip with no stops has no cities to count (#419): say nothing rather than "0 cities".
    cities > 0 ? citiesText(cities) : "",
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

/**
 * The trip's stops, or its one destination as a stop when it has none (a single-destination trip may be stored without
 * stops), so the route, the facts and the map treat both the same way.
 */
export function stopsOrDestination(trip: {
  stops: readonly TripStop[];
  location?: SampleLocation | null;
  start: string;
  end: string;
}): TripStop[] {
  if (trip.stops.length > 0) return [...trip.stops];
  return trip.location ? [{ location: trip.location, arrive: trip.start, leave: trip.end }] : [];
}

/** A place's coordinates: its own (a provider place), else the curated table's, else none. */
function pointOf(place: Pick<SampleLocation, "id" | "latitude" | "longitude">) {
  if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
    return { lat: place.latitude as number, lng: place.longitude as number };
  }
  return curatedCoordinates(place.id);
}

/**
 * The points the route map draws: the origin first (as home) when it has coordinates, then every stop that has them.
 * A place with no known coordinates is left out (never guessed), so the list can be shorter than the route; the map
 * is shown only when at least one stop remains (otherwise the list is empty).
 */
export function tripRoutePoints(trip: {
  origin?: TripOrigin | null;
  stops: readonly TripStop[];
  location?: SampleLocation | null;
  start: string;
  end: string;
}): RoutePoint[] {
  const points: RoutePoint[] = [];
  const home = trip.origin ? pointOf(trip.origin.location) : null;
  if (trip.origin && home) {
    points.push({
      ...home,
      kind: "home",
      label: trip.origin.location.city.trim(),
      ...(trip.origin.airportCode ? { code: trip.origin.airportCode } : {}),
    });
  }
  for (const stop of stopsOrDestination(trip)) {
    const at = pointOf(stop.location);
    if (!at) continue;
    points.push({
      ...at,
      kind: "stop",
      label: stop.location.city.trim(),
      ...(stop.airportCode ? { code: stop.airportCode } : {}),
    });
  }
  return points.some((point) => point.kind === "stop") ? points : [];
}

/** A short stable string for a set of map points, so a map drawn earlier can be checked against the trip as it is now. */
export function routeSignature(
  points: readonly RoutePoint[],
  mode: TravelMode | null | undefined,
): string {
  return JSON.stringify([mode ?? "other", points.map((p) => [p.kind, p.lat, p.lng, p.label])]);
}

/**
 * The trip as the Home draws it: a trip with no origin of its own starts from the account's Home (#497), so a Home saved
 * after the trip was made still supplies the missing start. An explicit origin is never replaced, and nothing is stored.
 */
export function withHomeOrigin<T extends { origin?: TripOrigin | null }>(
  trip: T,
  home: TripOrigin | null | undefined,
): T {
  return trip.origin || !home ? trip : { ...trip, origin: home };
}
