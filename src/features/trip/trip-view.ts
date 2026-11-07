// Pure view logic for the trip screen (#16). No React, no clock.

import { allPacked } from "@/domain/readiness";
import { toiletryBagState, toiletryItems } from "@/domain/toiletry-bag";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";

export const isComplete = (item: Pick<TripItem, "packed" | "qty">): boolean =>
  item.packed >= item.qty;

export interface TripSections {
  /** Everyday and occasion items (not Bathroom, not the return set). */
  main: TripItem[];
  /** The one canonical Bathroom group. */
  toiletries: TripItem[];
  returns: TripItem[];
  /** Pack last is a timing view: items flagged Pack last, with Bathroom ones left in Toiletries (one canonical row each). */
  packLast: TripItem[];
}

export function tripSections(trip: LifecycleTrip): TripSections {
  const inBag = new Set(toiletryItems(trip).map((item) => item.id));
  return {
    main: trip.items.filter((item) => item.section === "main" && !inBag.has(item.id)),
    toiletries: toiletryItems(trip),
    returns: trip.items.filter((item) => item.section === "return"),
    packLast: trip.items.filter((item) => item.section === "packlast" && !inBag.has(item.id)),
  };
}

export interface BagGate {
  /** none: no Bathroom items, so there is no gate. */
  state: "none" | "waiting" | "pending" | "complete";
  checked: number;
  total: number;
}

const GATE_STATES = {
  CONTENTS_INCOMPLETE: "waiting",
  ALL_CHECKED_BAG_OUTSIDE: "pending",
  BAG_IN_SUITCASE: "complete",
} as const;

export function bagGate(trip: LifecycleTrip): BagGate {
  const contents = toiletryItems(trip);
  return {
    state: contents.length === 0 ? "none" : GATE_STATES[toiletryBagState(trip)],
    checked: contents.filter(isComplete).length,
    total: contents.length,
  };
}

/** Finishing the last item only reveals "Review your bag"; it never marks Ready. */
export const showReviewPrompt = (trip: LifecycleTrip): boolean => allPacked(trip) && !trip.ready;

/** "Socks 2 of 5 packed": the text a live region announces after a +/- tap. */
export const packedAnnouncement = (item: Pick<TripItem, "name" | "packed" | "qty">): string =>
  `${item.name} ${item.packed} of ${item.qty} packed`;
