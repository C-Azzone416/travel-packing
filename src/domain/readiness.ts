// Readiness and toiletry-bag commands (plan §9, §10). Pure and immutable:
// every command returns a new trip (or the same reference when nothing changed).

import {
  isToiletryItem,
  toiletryContentsComplete,
  toiletryItems,
  type PackableItem,
  type ReadinessTrip,
} from "./toiletry-bag";

export type RejectionReason =
  "ITEM_NOT_FOUND" | "DUPLICATE_ITEM" | "NOT_ALL_PACKED" | "CONTENTS_INCOMPLETE";

export interface Signals {
  /** The last Bathroom content was just checked; the UI may offer bag placement. Never confirms it. */
  promptBagPlacement: boolean;
  /** Everything is packed but the trip is not Ready; the UI may offer "Review your bag". */
  reviewPrompt: boolean;
}

export type CommandResult<T> =
  { ok: true; trip: T; signals: Signals } | { ok: false; reason: RejectionReason; trip: T };

/**
 * Checklist changes that are not item edits but must still revoke Ready.
 * TODO(#25/#26): recalculation and suggestion-change behavior is a pending product call;
 * every such change funnels through revokeReadyForChange so it can be adjusted in one place.
 */
export type ChecklistChange = "recalculate" | "suggestion-change" | "weather-accepted";

const NO_SIGNALS: Signals = { promptBagPlacement: false, reviewPrompt: false };

function accepted<T>(trip: T, signals: Signals = NO_SIGNALS): CommandResult<T> {
  return { ok: true, trip, signals };
}

function rejected<T>(trip: T, reason: RejectionReason): CommandResult<T> {
  return { ok: false, reason, trip };
}

/** Whole number in 0..qty. Non-finite input (NaN, +/-Infinity) is treated as 0, not as "fully packed". */
export function clampPacked(packed: number, qty: number): number {
  const whole = Number.isFinite(packed) ? Math.trunc(packed) : 0;
  return Math.min(Math.max(whole, 0), qty);
}

/** Quantities are whole numbers >= 1; anything else (0, negatives, NaN, Infinity) becomes 1, fractions truncate. */
export function normalizeQty(qty: number): number {
  return Math.max(1, Number.isFinite(qty) ? Math.trunc(qty) : 1);
}

export function allPacked(trip: ReadinessTrip): boolean {
  const itemsPacked = trip.items.length > 0 && trip.items.every((item) => item.packed >= item.qty);
  return itemsPacked && (toiletryItems(trip).length === 0 || trip.toiletryBagPacked);
}

/** Packed totals count the bag-placement gate as one extra unit when toiletries exist. */
export function packedTotals(trip: ReadinessTrip): { packed: number; total: number } {
  const totals = trip.items.reduce(
    (sum, item) => ({
      packed: sum.packed + Math.min(item.packed, item.qty),
      total: sum.total + item.qty,
    }),
    { packed: 0, total: 0 },
  );
  if (toiletryItems(trip).length === 0) return totals;
  return { packed: totals.packed + (trip.toiletryBagPacked ? 1 : 0), total: totals.total + 1 };
}

/** Restore invariants: the bag cannot stay placed without complete contents; Ready needs allPacked. */
function normalize<T extends ReadinessTrip>(trip: T): T {
  const bagPacked = trip.toiletryBagPacked && toiletryContentsComplete(trip);
  const next =
    bagPacked === trip.toiletryBagPacked ? trip : { ...trip, toiletryBagPacked: bagPacked };
  return next.ready && !allPacked(next) ? { ...next, ready: false } : next;
}

function replaceItem<T extends ReadinessTrip>(trip: T, item: PackableItem): T {
  return {
    ...trip,
    items: trip.items.map((entry) => (entry.id === item.id ? { ...entry, ...item } : entry)),
  };
}

function findItem(trip: ReadinessTrip, itemId: string): PackableItem | undefined {
  return trip.items.find((item) => item.id === itemId);
}

export function setPacked<T extends ReadinessTrip>(
  trip: T,
  itemId: string,
  packed: number,
): CommandResult<T> {
  const item = findItem(trip, itemId);
  if (!item) return rejected(trip, "ITEM_NOT_FOUND");
  const nextPacked = clampPacked(packed, item.qty);
  if (nextPacked === item.packed) return accepted(trip);

  const next = normalize(replaceItem(trip, { ...item, packed: nextPacked }));
  const completedContents = !toiletryContentsComplete(trip) && toiletryContentsComplete(next);
  return accepted(next, {
    promptBagPlacement: isToiletryItem(item) && completedContents && !next.toiletryBagPacked,
    reviewPrompt: allPacked(next) && !next.ready,
  });
}

export function togglePacked<T extends ReadinessTrip>(trip: T, itemId: string): CommandResult<T> {
  const item = findItem(trip, itemId);
  if (!item) return rejected(trip, "ITEM_NOT_FOUND");
  return setPacked(trip, itemId, item.packed >= item.qty ? 0 : item.qty);
}

export function incrementPacked<T extends ReadinessTrip>(
  trip: T,
  itemId: string,
): CommandResult<T> {
  const item = findItem(trip, itemId);
  if (!item) return rejected(trip, "ITEM_NOT_FOUND");
  return setPacked(trip, itemId, item.packed + 1);
}

export function decrementPacked<T extends ReadinessTrip>(
  trip: T,
  itemId: string,
): CommandResult<T> {
  const item = findItem(trip, itemId);
  if (!item) return rejected(trip, "ITEM_NOT_FOUND");
  return setPacked(trip, itemId, item.packed - 1);
}

/** Edit an item's quantity. Always revokes Ready; a changed Bathroom quantity invalidates bag placement. */
export function editItemQty<T extends ReadinessTrip>(
  trip: T,
  itemId: string,
  qty: number,
): CommandResult<T> {
  const item = findItem(trip, itemId);
  if (!item) return rejected(trip, "ITEM_NOT_FOUND");
  const nextQty = normalizeQty(qty);
  const edited = replaceItem(trip, {
    ...item,
    qty: nextQty,
    packed: Math.min(item.packed, nextQty),
  });
  const bagInvalidated = isToiletryItem(item) && nextQty !== item.qty;
  return accepted(
    normalize({
      ...edited,
      ready: false,
      toiletryBagPacked: bagInvalidated ? false : edited.toiletryBagPacked,
    }),
  );
}

/** Adding any item revokes Ready; adding a Bathroom item also invalidates bag placement. */
export function addItem<T extends ReadinessTrip>(
  trip: T,
  item: T["items"][number],
): CommandResult<T> {
  if (findItem(trip, item.id)) return rejected(trip, "DUPLICATE_ITEM");
  const qty = normalizeQty(item.qty);
  const added = { ...item, qty, packed: clampPacked(item.packed, qty) };
  const bagPacked = isToiletryItem(added) ? false : trip.toiletryBagPacked;
  return accepted(
    normalize({
      ...trip,
      items: [...trip.items, added],
      ready: false,
      toiletryBagPacked: bagPacked,
    }),
  );
}

/** Removing any item revokes Ready; removing a Bathroom item also invalidates bag placement. */
export function removeItem<T extends ReadinessTrip>(trip: T, itemId: string): CommandResult<T> {
  const item = findItem(trip, itemId);
  if (!item) return rejected(trip, "ITEM_NOT_FOUND");
  const bagPacked = isToiletryItem(item) ? false : trip.toiletryBagPacked;
  const items = trip.items.filter((entry) => entry.id !== itemId);
  return accepted(normalize({ ...trip, items, ready: false, toiletryBagPacked: bagPacked }));
}

/** Single switch point for non-item checklist changes that revoke Ready. See ChecklistChange TODO. */
export function revokeReadyForChange<T extends ReadinessTrip>(
  trip: T,
  change: ChecklistChange,
): CommandResult<T> {
  void change;
  return accepted(trip.ready ? { ...trip, ready: false } : trip);
}

/** Explicit confirmation that the bag is in the suitcase. Requires all Bathroom contents checked. */
export function confirmBagPlacement<T extends ReadinessTrip>(trip: T): CommandResult<T> {
  if (!toiletryContentsComplete(trip)) return rejected(trip, "CONTENTS_INCOMPLETE");
  if (trip.toiletryBagPacked) return accepted(trip);
  return accepted({ ...trip, toiletryBagPacked: true });
}

/** Take the bag back out. Contents stay checked; Ready is revoked. */
export function undoBagPlacement<T extends ReadinessTrip>(trip: T): CommandResult<T> {
  if (!trip.toiletryBagPacked) return accepted(trip);
  return accepted({ ...trip, toiletryBagPacked: false, ready: false });
}

/** The only way to set Ready. Completing the last item never does it. */
export function markReady<T extends ReadinessTrip>(trip: T): CommandResult<T> {
  if (!allPacked(trip)) return rejected(trip, "NOT_ALL_PACKED");
  if (trip.ready) return accepted(trip);
  return accepted({ ...trip, ready: true });
}

/** Clears Ready without touching packed quantities or bag placement. */
export function markNotReady<T extends ReadinessTrip>(trip: T): CommandResult<T> {
  return accepted(trip.ready ? { ...trip, ready: false } : trip);
}
