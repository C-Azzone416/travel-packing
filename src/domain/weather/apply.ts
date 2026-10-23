import { TOILETRY_GROUP_ID } from "../toiletry-bag";
import { canonicalItemId } from "../item-identity";
import type { Trip, TripItem } from "../trip";
import type { Suggestion } from "../calc";
import type { WeatherSuggestion } from "./recommend";

export type WeatherApplyItem = Pick<
  WeatherSuggestion,
  "semanticId" | "name" | "category" | "qty" | "optional" | "groupId"
>;

export type WeatherAppliedChange =
  | { kind: "add"; semanticId: string; item: WeatherApplyItem }
  | { kind: "remove"; semanticId: string }
  | { kind: "split"; semanticId: string; clothing: Suggestion[] };

const CLOTHING_IDS = new Set([
  "tops",
  "bottoms",
  "tops-short",
  "tops-long",
  "bottoms-shorts",
  "bottoms-pants",
]);

/** Apply only the changes the person checked in the review sheet. Skipped-state persistence is handled separately. */
export function applyWeatherChanges<T extends Trip>(
  trip: T,
  changes: readonly WeatherAppliedChange[],
): T {
  if (changes.length === 0) return trip;
  let items = [...trip.items];
  let addedToiletry = false;

  for (const change of changes) {
    if (change.kind === "remove") {
      items = items.filter(
        (item) =>
          item.stapleCadence !== undefined ||
          canonicalItemId(item.id) !== canonicalItemId(change.semanticId),
      );
      continue;
    }
    if (change.kind === "split") {
      items = items.filter(
        (item) => item.stapleCadence !== undefined || !CLOTHING_IDS.has(canonicalItemId(item.id)),
      );
      items.push(
        ...change.clothing
          .filter(
            (line) =>
              !items.some(
                (item) => canonicalItemId(item.id) === canonicalItemId(line.semanticId ?? line.id),
              ),
          )
          .map<TripItem>((line) => ({
            id: line.semanticId ?? line.id,
            name: line.name,
            category: line.category,
            qty: line.qty,
            packed: 0,
            section: "main",
            ...(line.optional ? { optional: true } : {}),
            ...(line.groupId ? { groupId: line.groupId } : {}),
          })),
      );
      continue;
    }
    if (items.some((item) => canonicalItemId(item.id) === canonicalItemId(change.semanticId)))
      continue;
    const extra = change.item;
    items.push({
      id: extra.semanticId,
      name: extra.name,
      category: extra.category,
      qty: extra.qty,
      packed: 0,
      section: "main",
      optional: extra.optional,
      ...(extra.groupId ? { groupId: extra.groupId } : {}),
    });
    if (extra.groupId === TOILETRY_GROUP_ID) addedToiletry = true;
  }

  return {
    ...trip,
    items,
    ready: false,
    toiletryBagPacked: addedToiletry ? false : trip.toiletryBagPacked,
    weather: { ...trip.weather, status: "accepted" },
  };
}
