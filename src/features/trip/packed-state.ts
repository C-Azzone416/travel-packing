// Where a trip is on the way to Ready (#411, spec on #393 section 2.4). Pure view logic: no React, no clock.
//
// Two steps stay separate: ALL PACKED is derived (every item at its quantity) and Ready is the person's confirmation, which any
// list change revokes. The toiletry-bag gate belongs to the Ready step (the "Review your bag" sheet), so it does not hold back
// "All packed".

import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { isComplete } from "./trip-view";

export type PackedState = "open" | "packed" | "ready";

export function packedState(trip: Pick<LifecycleTrip, "items" | "ready">): PackedState {
  if (trip.ready) return "ready";
  return trip.items.length > 0 && trip.items.every(isComplete) ? "packed" : "open";
}

/** The Packing page with the "Review your bag" sheet open. */
export const reviewHref = (tripId: string): string => `/trips/${tripId}?review=1`;
