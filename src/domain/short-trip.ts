// Short trips (Suitcase P3, #412; spec #393 section 3): what collapses on a day trip or a trip with little to launder.
// Pure rules shared by Home, Packing, Edit trip and Plan, so no screen decides them on its own.

import { calculateSuggestions } from "./calc";
import { recalculateSuggestions } from "./item-ops";
import type { SuggestFn, Trip, TripConfig } from "./trip";

/** A day trip begins and ends on the same date (0 nights). A trip with no usable dates is not one. */
export function isDayTrip(trip: Pick<Trip, "start" | "end">): boolean {
  return Boolean(trip.start) && trip.start === trip.end;
}

/**
 * True when flipping the laundry preference would change at least one quantity on this trip (a Staple flagged with the
 * laundry mark gets smaller, or the Smart tops and bottoms do). Recalculated the way a preferences save does it, so the
 * answer is never different from what the toggle would then do.
 */
export function laundryChangesQuantity(
  trip: Trip,
  config: TripConfig = trip.config,
  suggest: SuggestFn = calculateSuggestions,
): boolean {
  const base = { ...trip, config };
  const flipped = recalculateSuggestions(base, { ...config, laundry: !config.laundry }, suggest);
  const same = recalculateSuggestions(base, config, suggest);
  const after = new Map(flipped.items.map((item) => [item.id, item.qty]));
  // Only rows the trip actually has: the calculator can synthesize Smart rows in both runs that the list never contained.
  const present = new Set(trip.items.map((item) => item.id));
  return same.items.some((item) => present.has(item.id) && after.get(item.id) !== item.qty);
}

/**
 * Whether the laundry control is offered: only when it changes a quantity, or when laundry is already on (a trip that
 * got shorter keeps the control so the person can turn it off).
 */
export function laundryControlVisible(trip: Trip, config: TripConfig = trip.config): boolean {
  return config.laundry || laundryChangesQuantity(trip, config);
}
