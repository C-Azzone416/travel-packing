// Pure view logic for "Review your bag" (#17). No React, no clock.

import { toiletryItems } from "@/domain/toiletry-bag";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { isComplete } from "./trip-view";

const unpacked = (trip: LifecycleTrip): number =>
  trip.items.filter((item) => !isComplete(item)).length;

/** Whether the bag-placement step still blocks Ready: toiletries exist and the bag is not in the suitcase. */
const bagOutstanding = (trip: LifecycleTrip): boolean =>
  toiletryItems(trip).length > 0 && !trip.toiletryBagPacked;

/**
 * Why "I'm ready to go" is not available, in words (shown next to the button and referenced by it), or null when
 * it is. Mirrors the domain's rule: every item fully packed, and the bag placed when there are toiletries.
 */
export function readyBlocker(trip: LifecycleTrip): string | null {
  const left = unpacked(trip);
  if (left > 0) return `Check off ${left} more ${left === 1 ? "item" : "items"}`;
  if (bagOutstanding(trip)) return "Confirm your toiletry bag is in the suitcase.";
  return null;
}

/**
 * When a change took a Ready trip back to packing, the short reason for the "No longer ready" toast; null when
 * Ready was not revoked. Compares the trip before and after the server confirmed the change.
 */
export function revocationReason(before: LifecycleTrip, after: LifecycleTrip): string | null {
  if (!before.ready || after.ready) return null;
  const lessPacked = after.items.some((item) => {
    const was = before.items.find((entry) => entry.id === item.id);
    return was !== undefined && item.packed < was.packed;
  });
  if (lessPacked) return "an item was unchecked";
  if (toiletryItems(before).length > 0 && before.toiletryBagPacked && !after.toiletryBagPacked) {
    return "the toiletry bag is no longer in the suitcase";
  }
  return "your list changed";
}
