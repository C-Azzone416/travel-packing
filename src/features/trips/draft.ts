// Pure helpers for the create/copy flow. A draft lives only in component state: nothing is
// persisted until the explicit Save, so cancelling can never leave a trace.

import {
  normalizeTripDates,
  RETURN_OFF_POLICY,
  type ReturnOffPolicy,
  type Suggestions,
} from "@/domain/calc";
import {
  startCopyDraft,
  startDraft,
  setDraftDates,
  type LifecycleTrip,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import { fixSummary, stopProblems } from "./stops-draft";

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

/** Why Continue is unavailable, in words, or null when the first step is complete. */
export function continueBlocker(draft: TripDraft): string | null {
  if (draft.stops && draft.stops.length > 1) {
    const problems = stopProblems(draft.stops);
    return problems.length ? fixSummary(problems.length) : null;
  }
  if (!draft.location) return "Choose a destination from the list to continue.";
  if (!draft.start || !draft.end || !normalizeTripDates(draft.start, draft.end).valid) {
    return "Choose your departure and return dates to continue.";
  }
  return null;
}

/** True when the user changed anything from where the draft started (drives the discard prompt). */
export function isDirty(draft: TripDraft, initial: TripDraft, query: string): boolean {
  return (
    query.trim() !== "" ||
    JSON.stringify({ ...draft, config: sortKeys(draft.config) }) !==
      JSON.stringify({ ...initial, config: sortKeys(initial.config) })
  );
}

function sortKeys<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) as T;
}

/** "Everyday tops: 3, Socks: 5" for what changed between two calculations, for a polite live region. */
export function describeChanges(before: Suggestions, after: Suggestions): string {
  const was = new Map(before.items.map((item) => [item.id, item.qty]));
  const now = new Map(after.items.map((item) => [item.id, item.qty]));
  const changes: string[] = [];
  for (const item of after.items) {
    if (was.get(item.id) !== item.qty) changes.push(`${item.name}: ${item.qty}`);
  }
  for (const item of before.items) {
    if (!now.has(item.id)) changes.push(`${item.name}: 0`);
  }
  return changes.length ? changes.join(", ") : "List unchanged";
}

/** The description under the Nice outfits switch: the Shape step and the Edit trip preferences use this one text (#203, design on #213). */
export const NICE_OUTFITS_DESCRIPTION =
  "Adds planned occasion looks on top of your everyday outfits, plus optional Dress shoes.";

/** The line under the Nice outfits switch while it is off: why Occasions and Reuse are disabled. */
export const NICE_OFF_HINT = "Turn on Nice outfits to set occasions.";

/** Helper text under the return-outfit switch. The "off" wording must match what the calculator does (#25). */
export function returnOutfitHelp(on: boolean, policy: ReturnOffPolicy = RETURN_OFF_POLICY): string {
  if (on) {
    return "A fresh top, bottoms, underwear and socks for the trip home. It replaces one everyday outfit, for your return day.";
  }
  return policy === "add-return-day-back"
    ? "Your return day is packed like any other day."
    : "No separate return outfit. Your return day is not added to the everyday count.";
}
