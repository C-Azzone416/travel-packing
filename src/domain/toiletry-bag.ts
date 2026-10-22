// Toiletry-bag selectors (plan §10). Pure; no framework imports.

export const TOILETRY_GROUP_ID = "toiletry-bag";

export interface PackableItem {
  id: string;
  qty: number;
  packed: number;
  groupId?: string | null;
}

export interface ReadinessTrip<I extends PackableItem = PackableItem> {
  items: I[];
  toiletryBagPacked: boolean;
  ready: boolean;
}

export type ToiletryBagState =
  "CONTENTS_INCOMPLETE" | "ALL_CHECKED_BAG_OUTSIDE" | "BAG_IN_SUITCASE";

export function isToiletryItem(item: PackableItem): boolean {
  return item.groupId === TOILETRY_GROUP_ID;
}

export function toiletryItems<I extends PackableItem>(trip: ReadinessTrip<I>): I[] {
  return trip.items.filter(isToiletryItem);
}

/** True only when toiletries exist and every one is fully packed. */
export function toiletryContentsComplete(trip: ReadinessTrip): boolean {
  const contents = toiletryItems(trip);
  return contents.length > 0 && contents.every((item) => item.packed >= item.qty);
}

export function toiletryBagState(trip: ReadinessTrip): ToiletryBagState {
  if (!toiletryContentsComplete(trip)) return "CONTENTS_INCOMPLETE";
  return trip.toiletryBagPacked ? "BAG_IN_SUITCASE" : "ALL_CHECKED_BAG_OUTSIDE";
}
