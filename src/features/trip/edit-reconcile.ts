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

/** Whether the person edited Leave / Come home themselves (their own controls), as opposed to a stop edit moving those dates. */
export interface EndpointsTouched {
  leave: boolean;
  home: boolean;
}

const firstArrive = (stops: readonly { arrive: string }[]) => stops[0]?.arrive ?? "";
const lastLeave = (stops: readonly { leave: string }[]) => stops[stops.length - 1]?.leave ?? "";

/** The one invariant: an endpoint stays the person's only while it still differs from the baseline's. Applied after every draft change and rebase. */
export function settleTouched(
  touched: EndpointsTouched,
  draft: readonly DraftStop[],
  baseline: readonly { arrive: string; leave: string }[],
): EndpointsTouched {
  return {
    leave: touched.leave && firstArrive(draft) !== firstArrive(baseline),
    home: touched.home && lastLeave(draft) !== lastLeave(baseline),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The route is three fields. The places (which stops, in what order, and the nights at every stop but the last) are ONE field: if
 * the person touched that, their whole list is kept, and Leave and Come home are still reconciled on their own. Otherwise the fresh route is taken, with the person's own Leave (first arrival)
 * and Come home (last leave) applied on top when they changed those.
 */
export function reconcileStops(
  base: readonly DraftStop[],
  draft: readonly DraftStop[],
  fresh: readonly TripStop[],
  touched: EndpointsTouched,
): DraftStop[] {
  if (same(base, draft)) return [...fresh];
  // Which places, in order, with the nights at each stop but the last (the last stop's nights are Leave and Come home's business).
  const shape = (stops: readonly DraftStop[]) =>
    stops.map((stop, at) => [
      stop.location?.id ?? null,
      at < stops.length - 1 ? daysBetween(stop.arrive, stop.leave) : null,
    ]);
  // The stop group, if touched, is the person's as a unit; otherwise the fresh route is the start. Either way Leave and Come home
  // are their own fields, and whose date wins comes ONLY from the flags (the person used that control and it still differs from
  // the baseline): an endpoint they did not edit takes the server's date. Leave is applied first (it moves the whole list); Come
  // home then sets the last stop's end. A server end the person's stops cannot fit (too few nights for the last stop) is skipped:
  // the list keeps the end its own nights give. The person's own Come home is always kept (validation reports a bad one).
  const stopsTouched = !same(shape(base), shape(draft));
  const leaveTouched = touched.leave && firstArrive(base) !== firstArrive(draft);
  const homeTouched = touched.home && lastLeave(base) !== lastLeave(draft);
  let mine: DraftStop[] = stopsTouched ? [...draft] : [...fresh];
  const wantStart = leaveTouched ? firstArrive(draft) : (fresh[0]?.arrive ?? "");
  const wantEnd = homeTouched ? lastLeave(draft) : (fresh[fresh.length - 1]?.leave ?? "");
  if (wantStart && wantStart !== firstArrive(mine)) mine = setFirstArrive(mine, wantStart);
  const at = mine.length - 1;
  if (wantEnd && at >= 0 && wantEnd !== lastLeave(mine)) {
    const minNights = mine.length > 1 ? 1 : 0;
    if (homeTouched || daysBetween(mine[at].arrive, wantEnd) >= minNights)
      mine = setLeave(mine, at, wantEnd);
  }
  return mine;
}

/** Each preference key and the travel mode on its own: the person's value if they changed it, else the fresh one. */
export function reconcile(
  base: EditFields,
  draft: EditFields,
  fresh: { stops: readonly TripStop[]; config: TripConfig; travelMode: TravelMode | null },
  touched: EndpointsTouched,
): EditFields {
  const config = { ...fresh.config };
  for (const key of Object.keys(config) as (keyof TripConfig)[]) {
    if (base.config[key] !== draft.config[key])
      (config as Record<string, unknown>)[key] = draft.config[key];
  }
  return {
    stops: reconcileStops(base.stops, draft.stops, fresh.stops, touched),
    config,
    travelMode: base.travelMode !== draft.travelMode ? draft.travelMode : fresh.travelMode,
  };
}
