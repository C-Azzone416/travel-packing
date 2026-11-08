// Pure helpers for the create/copy flow. A draft lives only in component state: nothing is
// persisted until the explicit Save, so cancelling can never leave a trace.

import { normalizeTripDates } from "@/domain/calc";
import {
  startCopyDraft,
  startDraft,
  setDraftDates,
  type LifecycleTrip,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";

// The defaults for a brand-new trip (#205): return outfit on, Nice outfits OFF (occasions and reuse stay inert until it is turned on).
export const DEFAULT_TRIP_CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: true,
  returnOutfit: true,
};

export const MIN_OCCASIONS = 1;
export const MAX_OCCASIONS = 8;

/** A new draft starts with no destination and no dates: free text alone never continues. */
export function newDraft(): TripDraft {
  return startDraft(DEFAULT_TRIP_CONFIG, "", "");
}

/** A copy keeps the source's preferences and asks for a new destination and dates. */
export function copyDraft(source: LifecycleTrip): TripDraft {
  // A multi-stop source keeps its route (the person picks the new first arrival and every stop shifts);
  // a single-stop source starts empty, as before.
  return source.stops.length > 1
    ? startCopyDraft(source, source.start, source.end)
    : startCopyDraft(source, "", "");
}

export function clampOccasions(value: number): number {
  const whole = Number.isFinite(value) ? Math.trunc(value) : MIN_OCCASIONS;
  return Math.min(MAX_OCCASIONS, Math.max(MIN_OCCASIONS, whole));
}

export interface DatesChange {
  draft: TripDraft;
  /** True only when a return date earlier than departure was moved to match it. */
  adjusted: boolean;
}

// An empty field is left alone (the user is still typing); only two real dates are normalized.
export function withDates(draft: TripDraft, start: string, end: string): DatesChange {
  if (!start || !end) return { draft: { ...draft, start, end }, adjusted: false };
  return {
    draft: setDraftDates(draft, start, end),
    adjusted: normalizeTripDates(start, end).adjusted,
  };
}

/** The description under the Nice outfits switch: the Shape step and the Edit trip preferences use this one text (#203, design on #213). */
export const NICE_OUTFITS_DESCRIPTION =
  "Adds planned occasion looks on top of your everyday outfits, plus optional Dress shoes.";

/** The line under the Nice outfits switch while it is off: why Occasions and Reuse are disabled. */
export const NICE_OFF_HINT = "Turn on Nice outfits to set occasions.";

/** Helper text under the return-outfit switch. The "off" wording must match what the calculator does (#25). */
export function returnOutfitHelp(on: boolean): string {
  if (on) {
    return "A fresh top, bottoms, underwear and socks for the trip home. It replaces one everyday outfit, for your return day.";
  }
  return "Your return day is packed like any other day.";
}
