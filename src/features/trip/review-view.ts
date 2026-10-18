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

export interface ReviewStatus {
  status: string;
  help: string;
}

/** The callout above the actions (prototype wording). */
export function reviewStatus(trip: LifecycleTrip): ReviewStatus {
  const contents = toiletryItems(trip);
  const contentsDone = contents.length > 0 && contents.every(isComplete);
  const complete = readyBlocker(trip) === null;
  if (trip.ready) {
    return {
      status: "This trip is currently Ready.",
      help: "Reviewing does not change that unless you choose below or correct an item.",
    };
  }
  if (contentsDone && !trip.toiletryBagPacked) {
    return {
      status: "Toiletry contents are checked, but the bag is not confirmed in the suitcase.",
      help: "Confirm the separate bag-placement step before Ready is available.",
    };
  }
  if (complete) {
    return { status: "Everything is packed.", help: "Ready is still your decision." };
  }
  return {
    status: "There are still unpacked items.",
    help: "Correct the items above before confirming.",
  };
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
