// Pure helpers for editing a draft's stops (epic #107, design #108 §1). A stop's arrive date is derived from the
// previous stop's leave date, so every edit here keeps the route contiguous and keeps each stop's number of nights
// unless the person changes a Leave date. No React, no clock.

import { parseDate } from "@/domain/calc";
import type { DraftStop } from "@/domain/trip-lifecycle";
import { addDays, daysBetween, MAX_STOPS } from "@/domain/trip-stops";
import { formatShortDate } from "./view";

const valid = (value: string) => parseDate(value) !== null;

/** Nights at a stop, or null while a date is blank or malformed. */
export function nightsAt(stop: Pick<DraftStop, "arrive" | "leave">): number | null {
  return valid(stop.arrive) && valid(stop.leave) ? daysBetween(stop.arrive, stop.leave) : null;
}

/** "1 night" / "3 nights". */
export function formatNights(nights: number): string {
  return nights === 1 ? "1 night" : `${nights} nights`;
}

export const canAddStop = (stops: readonly DraftStop[]) => stops.length < MAX_STOPS;

/**
 * Lay the stops end to end from `start`, keeping each stop's nights. A stop whose nights are unknown (blank dates)
 * keeps blank dates from there on.
 */
function chain(stops: readonly DraftStop[], start: string): DraftStop[] {
  let from = start;
  return stops.map((stop) => {
    const nights = nightsAt(stop);
    const arrive = from;
    const leave = valid(arrive) && nights !== null ? addDays(arrive, nights) : "";
    from = leave;
    return { ...stop, arrive, leave };
  });
}

/** A new last stop that arrives the day the previous one leaves and stays one night. */
export function addStop(stops: readonly DraftStop[]): DraftStop[] {
  if (!canAddStop(stops)) return [...stops];
  const arrive = stops[stops.length - 1].leave;
  const leave = valid(arrive) ? addDays(arrive, 1) : "";
  return [...stops, { location: null, arrive: valid(arrive) ? arrive : "", leave }];
}

/** Remove a stop and close the gap: later stops move up by the removed stop's nights. */
export function removeStop(stops: readonly DraftStop[], index: number): DraftStop[] {
  if (index < 0 || index >= stops.length || stops.length === 1) return [...stops];
  const rest = stops.filter((_, at) => at !== index);
  return chain(rest, index === 0 ? stops[0].arrive : rest[0].arrive);
}

/** Swap a stop with its neighbour. Each stop keeps its nights; dates are re-derived from the first arrival. */
export function moveStop(
  stops: readonly DraftStop[],
  index: number,
  direction: -1 | 1,
): DraftStop[] {
  const target = index + direction;
  if (index < 0 || index >= stops.length || target < 0 || target >= stops.length) {
    return [...stops];
  }
  const swapped = stops.map((stop, at) =>
    at === index ? stops[target] : at === target ? stops[index] : stop,
  );
  return chain(swapped, stops[0].arrive);
}

/**
 * Change a stop's Leave date. When it is still after the arrive date, every later stop shifts by the same number of
 * days (contiguity and nights kept). Otherwise only this stop changes and validation says why.
 */
export function setLeave(stops: readonly DraftStop[], index: number, leave: string): DraftStop[] {
  const stop = stops[index];
  if (!stop) return [...stops];
  const shifts =
    valid(leave) && valid(stop.leave) && valid(stop.arrive) && daysBetween(stop.arrive, leave) >= 1;
  const delta = shifts ? daysBetween(stop.leave, leave) : 0;
  return stops.map((entry, at) => {
    if (at === index) return { ...entry, leave };
    if (at > index && delta !== 0) {
      return {
        ...entry,
        arrive: addDays(entry.arrive, delta),
        leave: addDays(entry.leave, delta),
      };
    }
    return entry;
  });
}

/** Change the first stop's Arrive date. The whole trip moves with it (stops keep their nights). */
export function setFirstArrive(stops: readonly DraftStop[], arrive: string): DraftStop[] {
  if (stops.length === 0) return [];
  const first = stops[0];
  if (!valid(arrive) || !valid(first.arrive)) {
    return stops.map((stop, at) => (at === 0 ? { ...stop, arrive } : stop));
  }
  const delta = daysBetween(first.arrive, arrive);
  return stops.map((stop) => ({
    ...stop,
    arrive: addDays(stop.arrive, delta),
    leave: valid(stop.leave) ? addDays(stop.leave, delta) : stop.leave,
  }));
}

/** Snap every later stop's Arrive to the previous stop's Leave ("Fix dates"). */
export function snapContiguous(stops: readonly DraftStop[]): DraftStop[] {
  return stops.map((stop, at) => (at === 0 ? stop : { ...stop, arrive: stops[at - 1].leave }));
}

export type StopField = "place" | "arrive" | "leave";

export interface StopProblem {
  stopIndex: number;
  field: StopField;
  message: string;
}

/**
 * What stops Continue, in the order a person would fix it (stop by stop), with the words from the design spec.
 * Only a route of 2+ stops is checked here; one stop keeps the existing single-destination checks.
 */
export function stopProblems(stops: readonly DraftStop[]): StopProblem[] {
  const problems: StopProblem[] = [];
  stops.forEach((stop, index) => {
    if (!stop.location) {
      problems.push({
        stopIndex: index,
        field: "place",
        message: `Pick a place for Stop ${index + 1}, or choose Custom.`,
      });
    }
  });
  stops.forEach((stop, index) => {
    if (!valid(stop.arrive) || !valid(stop.leave)) {
      problems.push({
        stopIndex: index,
        field: index === 0 && !valid(stop.arrive) ? "arrive" : "leave",
        message: "Choose a date.",
      });
      return;
    }
    if (daysBetween(stop.arrive, stop.leave) < (stops.length > 1 ? 1 : 0)) {
      problems.push({
        stopIndex: index,
        field: "leave",
        message: "Stay at least one night. Leave must be after you arrive.",
      });
    }
    const previous = stops[index - 1];
    if (previous && valid(previous.leave) && previous.leave !== stop.arrive) {
      problems.push({
        stopIndex: index,
        field: "arrive",
        message: `Stop ${index + 1} must start the day you leave Stop ${index} (${formatShortDate(previous.leave)}).`,
      });
    }
  });
  return problems;
}

/** "Fix 2 things above to continue." */
export function fixSummary(count: number): string {
  return `Fix ${count} ${count === 1 ? "thing" : "things"} above to continue.`;
}

/** The summary strip: route, range and nights, or a prompt until every place is picked. */
export function routeSummary(stops: readonly DraftStop[]): string {
  if (stops.some((stop) => !stop.location)) {
    return "Pick a place for each stop to see your route.";
  }
  const cities = stops.map((stop) => (stop.location as { city: string }).city).join(" → ");
  const first = stops[0].arrive;
  const last = stops[stops.length - 1].leave;
  if (!valid(first) || !valid(last)) return cities;
  const nights = daysBetween(first, last);
  return `${cities} · ${formatShortDate(first)} – ${formatShortDate(last)} · ${formatNights(nights)}`;
}
