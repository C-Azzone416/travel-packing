// When the trip changes under an open Edit trip sheet (another device saved, or a stale save made the sheet reload), the draft is
// rebased FIELD BY FIELD against the baseline the draft was last in step with: a field the person changed keeps their value, a field
// they did not touch takes the fresh server value (#389). Pure.

import type { TripConfig } from "@/domain/trip";
import type { DraftStop } from "@/domain/trip-lifecycle";
import type { TravelMode } from "@/domain/trip-route";
import { daysBetween, type TripStop } from "@/domain/trip-stops";
import { setFirstArrive, setLeave } from "@/features/trips/stops-draft";

export interface EditFields {
  stops: readonly DraftStop[];
  config: TripConfig;
  travelMode: TravelMode | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The route is three fields. The places (which stops, in what order, and the nights at every stop but the last) are ONE field: if
 * the person touched that, their whole list is kept. Otherwise the fresh route is taken, with the person's own Leave (first arrival)
 * and Come home (last leave) applied on top when they changed those.
 */
export function reconcileStops(
  base: readonly DraftStop[],
  draft: readonly DraftStop[],
  fresh: readonly TripStop[],
): DraftStop[] {
  if (same(base, draft)) return [...fresh];
  const firstArrive = (stops: readonly DraftStop[]) => stops[0]?.arrive ?? "";
  const lastLeave = (stops: readonly DraftStop[]) => stops[stops.length - 1]?.leave ?? "";
  // Which places, in order, with the nights at each stop but the last (the last stop's nights are Leave and Come home's business).
  const shape = (stops: readonly DraftStop[]) =>
    stops.map((stop, at) => [
      stop.location?.id ?? null,
      at < stops.length - 1 ? daysBetween(stop.arrive, stop.leave) : null,
    ]);
  if (!same(shape(base), shape(draft))) return [...draft];
  let next: DraftStop[] = [...fresh];
  if (firstArrive(base) !== firstArrive(draft)) next = setFirstArrive(next, firstArrive(draft));
  // Come home counts as the person's when the last stop's nights changed; a Leave edit moves it too, but keeps the nights.
  const lastNights = (stops: readonly DraftStop[]) =>
    stops.length > 0
      ? daysBetween(stops[stops.length - 1].arrive, stops[stops.length - 1].leave)
      : 0;
  if (lastNights(base) !== lastNights(draft) && next.length > 0)
    next = setLeave(next, next.length - 1, lastLeave(draft));
  return next;
}

/** Each preference key and the travel mode on its own: the person's value if they changed it, else the fresh one. */
export function reconcile(
  base: EditFields,
  draft: EditFields,
  fresh: { stops: readonly TripStop[]; config: TripConfig; travelMode: TravelMode | null },
): EditFields {
  const config = { ...fresh.config };
  for (const key of Object.keys(config) as (keyof TripConfig)[]) {
    if (base.config[key] !== draft.config[key])
      (config as Record<string, unknown>)[key] = draft.config[key];
  }
  return {
    stops: reconcileStops(base.stops, draft.stops, fresh.stops),
    config,
    travelMode: base.travelMode !== draft.travelMode ? draft.travelMode : fresh.travelMode,
  };
}
