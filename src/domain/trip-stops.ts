// Ordered stops of a trip (epic #107 §1). Pure data and helpers; no framework imports.
//
// A trip has 1-6 stops. They are contiguous (a stop's leave date is the next stop's arrive date: the travel day),
// and every stop of a multi-stop trip is at least one night. A single stop may be a day trip (leave == arrive),
// exactly like a trip today. Trip start is the first arrive, trip end the last leave.

import { parseDate } from "./calc";

export interface SampleLocation {
  id: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  label: string;
  /** Extra place detail (e.g. a county), set only to tell apart results that share city, region and country. */
  detail?: string;
  /** Present only for a place that came from a geocoding provider (#47); curated entries have none of these. */
  provider?: string;
  providerPlaceId?: string;
  /** Rounded to 2 decimals (about 1 km) before they are ever stored. */
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export interface TripStop {
  location: SampleLocation;
  /** YYYY-MM-DD */
  arrive: string;
  /** YYYY-MM-DD; the next stop's arrive date. */
  leave: string;
  /** IATA code of the one airport reliably serving this stop (#152). Derived on the server, never stored or sent back. */
  airportCode?: string;
}

export const MAX_STOPS = 6;

export type StopsProblem =
  | "NO_STOPS"
  | "TOO_MANY_STOPS"
  | "INVALID_DATE"
  | "LEAVE_BEFORE_ARRIVE"
  | "NO_NIGHT"
  | "GAP"
  | "OVERLAP";

export type StopsValidation =
  { ok: true } | { ok: false; problem: StopsProblem; stopIndex: number | null };

const MS_PER_DAY = 86_400_000;

function dayNumber(value: string): number | null {
  const date = parseDate(value);
  return date ? date.getTime() / MS_PER_DAY : null;
}

/** First problem found, with the index of the stop it concerns (null when it concerns the list). */
export function validateStops(stops: readonly TripStop[]): StopsValidation {
  if (stops.length === 0) return { ok: false, problem: "NO_STOPS", stopIndex: null };
  if (stops.length > MAX_STOPS) return { ok: false, problem: "TOO_MANY_STOPS", stopIndex: null };
  let previousLeave: number | null = null;
  for (const [index, stop] of stops.entries()) {
    const arrive = dayNumber(stop.arrive);
    const leave = dayNumber(stop.leave);
    if (arrive === null || leave === null) {
      return { ok: false, problem: "INVALID_DATE", stopIndex: index };
    }
    if (leave < arrive) return { ok: false, problem: "LEAVE_BEFORE_ARRIVE", stopIndex: index };
    if (leave === arrive && stops.length > 1)
      return { ok: false, problem: "NO_NIGHT", stopIndex: index };
    if (previousLeave !== null && arrive > previousLeave) {
      return { ok: false, problem: "GAP", stopIndex: index };
    }
    if (previousLeave !== null && arrive < previousLeave) {
      return { ok: false, problem: "OVERLAP", stopIndex: index };
    }
    previousLeave = leave;
  }
  return { ok: true };
}

/** Trip start and end from the stops (first arrive, last leave). Callers validate first. */
export function tripDatesFromStops(stops: readonly TripStop[]): { start: string; end: string } {
  return { start: stops[0].arrive, end: stops[stops.length - 1].leave };
}

/**
 * The stop a day belongs to: the stop where arrive <= day < leave, and the final day belongs to the last stop.
 * A travel day therefore counts toward the stop you arrive at. A day outside the trip, or a malformed date, is null.
 */
export function stopIndexForDay(stops: readonly TripStop[], day: string): number | null {
  const target = dayNumber(day);
  if (target === null || stops.length === 0) return null;
  const last = stops.length - 1;
  const first = dayNumber(stops[0].arrive);
  const end = dayNumber(stops[last].leave);
  if (first === null || end === null || target < first || target > end) return null;
  if (target === end) return last;
  const index = stops.findIndex((stop) => {
    const arrive = dayNumber(stop.arrive);
    const leave = dayNumber(stop.leave);
    return arrive !== null && leave !== null && arrive <= target && target < leave;
  });
  return index === -1 ? null : index;
}

/** "Lisbon → Porto → Madrid", built from city names. */
export function routeLabel(stops: readonly TripStop[]): string {
  return stops.map((stop) => stop.location.city).join(" → ");
}

/** Add whole days to a YYYY-MM-DD date (UTC, so DST never matters). Malformed input is returned unchanged. */
export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  if (!date) return value;
  return new Date(date.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days between two valid dates (to - from). */
export function daysBetween(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? 0 : b - a;
}

/** Every stop moved by the same number of days, so copying a trip keeps its shape. */
export function shiftStops(stops: readonly TripStop[], days: number): TripStop[] {
  return stops.map((stop) => ({
    ...stop,
    location: { ...stop.location },
    arrive: addDays(stop.arrive, days),
    leave: addDays(stop.leave, days),
  }));
}
