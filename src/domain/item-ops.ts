// Item-level operations (plan §3 Packing preferences / Packing-list interaction, §11 Weather).
// Ported from reference/prototype/dist/app.js. Pure and immutable; Ready revocation and
// toiletry-bag invalidation go through the #5 state machines.

import {
  addItem,
  editItemQty,
  normalizeQty,
  removeItem,
  revokeReadyForChange,
  type RejectionReason,
} from "./readiness";
import { TOILETRY_GROUP_ID, toiletryItems } from "./toiletry-bag";
import { niceAccessoryKey } from "./calc";
import type { ItemSection, Scope, Staple, SuggestFn, Trip, TripConfig, TripItem } from "./trip";

/** Ids the calculator owns; everything else on a trip is user-added or canonical (Pack last, return, ...). */
/** The clothing lines a weather-aware list uses instead of "Everyday tops" / "Everyday bottoms" (epic #107 §3). */
const WEATHER_CLOTHING_IDS: ReadonlySet<string> = new Set([
  "tops-short",
  "tops-long",
  "bottoms-shorts",
  "bottoms-pants",
]);

export const CALCULATED_ITEM_IDS: ReadonlySet<string> = new Set([
  "tops",
  "bottoms",
  "underwear",
  "socks",
  "sleepwear",
  "nice-top",
  "nice-bottom",
  "nice-shoes",
  "nice-makeup",
  "nice-undergarments",
]);

/** Optional Nice-outfit suggestions; removing one suppresses it until the user restores it. */
export const OPTIONAL_NICE_IDS: ReadonlySet<string> = new Set([
  "nice-shoes",
  "nice-makeup",
  "nice-undergarments",
]);

export const WEATHER_UMBRELLA_ID = "weather-umbrella";

export type ItemOpRejection = RejectionReason | "EMPTY_NAME" | "INVALID_TIMING";

export type ItemOpResult<T> =
  | { ok: true; trip: T; staples: Staple[] }
  | { ok: false; reason: ItemOpRejection; trip: T; staples: Staple[] };

export interface ItemEdit {
  name: string;
  qty: number;
  timing: ItemSection;
  scope: Scope;
}

function accepted<T>(trip: T, staples: Staple[]): ItemOpResult<T> {
  return { ok: true, trip, staples };
}

function rejected<T>(trip: T, staples: Staple[], reason: ItemOpRejection): ItemOpResult<T> {
  return { ok: false, reason, trip, staples };
}

/**
 * What a trip quantity means for a staple. A per-trip staple stores the trip quantity as is. A per-day staple
 * must not store the trip total (it would multiply on the next trip): it stores the per-day amount, or keeps
 * its quantity when the trip has no packing days to divide by. (PM product call on #40.)
 */
function stapleQtyFor(existing: Staple, tripQty: number, dailyDays: number): number {
  if (existing.cadence === "per trip") return tripQty;
  return dailyDays > 0 ? Math.max(1, Math.round(tripQty / dailyDays)) : existing.qty;
}

export type RememberPreview =
  { kind: "per-day"; perDay: number } | { kind: "no-packing-days" } | null;

/**
 * What "Remember for future trips" would save for this item, read from the same rule the edit uses
 * (`stapleQtyFor`), so the editor's hint can never disagree with what is stored. Only an item that comes from a
 * per-day staple has anything to preview; a per-trip staple (or no staple) is stored as-is.
 */
export function rememberPreview(
  staples: readonly Staple[],
  itemId: string,
  tripQty: number,
  dailyDays: number,
): RememberPreview {
  const staple = staples.find((entry) => entry.id === itemId);
  if (!staple || staple.cadence !== "per day") return null;
  if (dailyDays <= 0) return { kind: "no-packing-days" };
  return { kind: "per-day", perDay: stapleQtyFor(staple, tripQty, dailyDays) };
}

function upsertStaple(staples: Staple[], item: TripItem, dailyDays: number): Staple[] {
  const packLast = item.section === "packlast";
  const groupId = item.groupId;
  const existing = staples.find((staple) => staple.id === item.id);
  if (!existing) {
    const added: Staple = {
      id: item.id,
      name: item.name,
      category: item.category,
      qty: item.qty,
      cadence: "per trip",
      packLast,
      ...(groupId ? { groupId } : {}),
    };
    return [...staples, added];
  }
  const { groupId: _previousGroup, ...rest } = existing;
  void _previousGroup;
  return staples.map((staple) =>
    staple.id === item.id
      ? {
          ...rest,
          name: item.name,
          qty: stapleQtyFor(existing, item.qty, dailyDays),
          packLast,
          ...(groupId ? { groupId } : {}),
        }
      : staple,
  );
}

/**
 * Edit name, quantity, and timing. "this-trip" never touches staples; "remember" updates (or creates)
 * the staple for future trips only. Always revokes Ready. Return-outfit items keep their `return` timing.
 */
export function editItem<T extends Trip>(
  trip: T,
  staples: Staple[],
  itemId: string,
  edit: ItemEdit,
): ItemOpResult<T> {
  const item = trip.items.find((entry) => entry.id === itemId);
  if (!item) return rejected(trip, staples, "ITEM_NOT_FOUND");
  const name = edit.name.trim();
  if (!name) return rejected(trip, staples, "EMPTY_NAME");
  const timings: ItemSection[] = ["main", "return", "packlast"];
  if (!timings.includes(edit.timing) || (edit.timing === "return" && item.section !== "return")) {
    return rejected(trip, staples, "INVALID_TIMING");
  }

  // The item exists (checked above), so editItemQty cannot reject; its trip is the edited trip.
  const qtyEdited = editItemQty(trip, itemId, edit.qty);
  const section: ItemSection = item.section === "return" ? "return" : edit.timing;
  const edited = qtyEdited.trip.items.find((entry) => entry.id === itemId)!;
  const updated: TripItem = { ...edited, name, section, userEdited: true };
  const nextTrip = {
    ...qtyEdited.trip,
    items: qtyEdited.trip.items.map((entry) => (entry.id === itemId ? updated : entry)),
  };
  return accepted(
    nextTrip,
    edit.scope === "remember" ? upsertStaple(staples, updated, trip.dailyDays) : staples,
  );
}

/**
 * Remove an item. Removing an optional Nice suggestion suppresses it (and drops its remembered copy);
 * "remember" also removes the matching staple so future trips do not re-add it.
 */
export function removeTripItem<T extends Trip>(
  trip: T,
  staples: Staple[],
  itemId: string,
  scope: Scope,
): ItemOpResult<T> {
  const item = trip.items.find((entry) => entry.id === itemId);
  if (!item) return rejected(trip, staples, "ITEM_NOT_FOUND");

  // The item exists, so removeItem cannot reject.
  let next = removeItem(trip, itemId).trip;
  if (item.optional && OPTIONAL_NICE_IDS.has(itemId)) {
    const { [itemId]: _forgotten, ...memory } = next.suggestionMemory;
    void _forgotten;
    next = {
      ...next,
      suppressedSuggestions: { ...next.suppressedSuggestions, [itemId]: true },
      suggestionMemory: memory,
    };
  }
  return accepted(
    next,
    scope === "remember" ? staples.filter((staple) => staple.id !== itemId) : staples,
  );
}

function toiletrySignature(trip: Trip): string {
  return toiletryItems(trip)
    .map((entry) => `${entry.id}:${entry.qty}`)
    .sort()
    .join("|");
}

/**
 * Recalculate suggestions after a preference change, merging with user edits (prototype
 * `reconcileTripSuggestions`). Also used for Nice outfits off/on: edits and progress survive through
 * `suggestionMemory`; explicitly removed optional suggestions stay suppressed. Revokes Ready, and
 * invalidates bag placement when the Bathroom contents change.
 */
export function recalculateSuggestions<T extends Trip>(
  trip: T,
  nextConfig: TripConfig,
  suggest: SuggestFn,
): T {
  const oldItems = trip.items;
  const oldSignature = toiletrySignature(trip);
  const suppressed = trip.suppressedSuggestions;

  const memory: Record<string, TripItem> = { ...trip.suggestionMemory };
  for (const entry of oldItems) {
    if (CALCULATED_ITEM_IDS.has(entry.id) && !suppressed[entry.id]) memory[entry.id] = { ...entry };
  }

  const calculated = suggest({ ...nextConfig, start: trip.start, end: trip.end });
  const nonCalculated = oldItems.filter((entry) => !CALCULATED_ITEM_IDS.has(entry.id));
  // A list already split by weather keeps its split clothing: recalculating must not add Everyday tops and
  // bottoms beside it. The weather review offers new counts for the split lines instead (epic #107 §4).
  const weatherClothing = oldItems.some((entry) => WEATHER_CLOTHING_IDS.has(entry.id));

  const nextSuggested = calculated.items
    .filter((suggestion) => !(weatherClothing && ["tops", "bottoms"].includes(suggestion.id)))
    .map((suggestion): TripItem => {
      const template: TripItem = {
        id: suggestion.id,
        name: suggestion.name,
        category: suggestion.category,
        qty: suggestion.qty,
        packed: 0,
        section: "main",
        optional: Boolean(suggestion.optional),
        ...(suggestion.id === "nice-makeup" ? { groupId: TOILETRY_GROUP_ID } : {}),
      };
      return template;
    })
    .filter((template) => {
      if (suppressed[template.id]) return false;
      const key = niceAccessoryKey(template);
      return !key || !nonCalculated.some((entry) => niceAccessoryKey(entry) === key);
    })
    .map((template): TripItem => {
      const existing = oldItems.find((entry) => entry.id === template.id);
      const source = existing ?? memory[template.id];
      if (!source) return template;
      const merged: TripItem = { ...template };
      if (source.userEdited || !existing) {
        merged.name = source.name;
        merged.qty = source.qty;
        merged.section = source.section;
        merged.userEdited = Boolean(source.userEdited);
      }
      merged.packed = Math.min(source.packed || 0, merged.qty);
      merged.optional = Boolean(template.optional || source.optional);
      const groupId =
        template.id === "nice-makeup" ? TOILETRY_GROUP_ID : (source.groupId ?? template.groupId);
      if (groupId) merged.groupId = groupId;
      else delete merged.groupId;
      return merged;
    });

  const recalculated: T = {
    ...trip,
    items: [...nextSuggested, ...nonCalculated],
    suggestionMemory: memory,
    config: { ...nextConfig },
    days: calculated.days,
    dailyDays: calculated.dailyDays,
  };
  const bagInvalidated = oldSignature !== toiletrySignature(recalculated);
  const next = bagInvalidated ? { ...recalculated, toiletryBagPacked: false } : recalculated;
  return revokeReadyForChange(next, "recalculate").trip;
}

export interface ToiletryItemInput {
  /** Caller-chosen unique id for the new Bathroom item. */
  id: string;
  name: string;
  qty: number;
  packLast: boolean;
  scope: Scope;
}

/**
 * Add a Bathroom (toiletry-bag) item: one canonical checkbox that also gates bag placement. Revokes Ready and
 * bag placement. "remember" also adds a per-trip staple so future trips get it. A duplicate id is rejected.
 */
export function addToiletryItem<T extends Trip>(
  trip: T,
  staples: Staple[],
  input: ToiletryItemInput,
): ItemOpResult<T> {
  const name = input.name.trim();
  if (!name) return rejected(trip, staples, "EMPTY_NAME");
  const item: TripItem = {
    id: input.id,
    name,
    category: "Toiletries",
    qty: normalizeQty(input.qty),
    packed: 0,
    section: input.packLast ? "packlast" : "main",
    groupId: TOILETRY_GROUP_ID,
  };
  const added = addItem(trip, item);
  if (!added.ok) return rejected(trip, staples, added.reason);
  const staple: Staple = {
    id: item.id,
    name,
    category: "Toiletries",
    qty: item.qty,
    cadence: "per trip",
    packLast: input.packLast,
    groupId: TOILETRY_GROUP_ID,
  };
  return accepted(added.trip, input.scope === "remember" ? [...staples, staple] : staples);
}

/**
 * Accept the simulated weather suggestion: adds exactly one canonical `weather-umbrella` item and
 * revokes Ready. Accepting again never adds a second umbrella.
 */
export function acceptWeather<T extends Trip>(trip: T): T {
  if (trip.weather.status === "accepted") return trip;
  const withStatus: T = { ...trip, weather: { ...trip.weather, status: "accepted" } };
  if (withStatus.items.some((entry) => entry.id === WEATHER_UMBRELLA_ID)) {
    return revokeReadyForChange(withStatus, "weather-accepted").trip;
  }
  const umbrella: TripItem = {
    id: WEATHER_UMBRELLA_ID,
    name: "Compact umbrella",
    category: "Weather suggestion",
    qty: 1,
    packed: 0,
    section: "main",
  };
  // addItem only rejects duplicate ids, which was ruled out above.
  return addItem(withStatus, umbrella).trip;
}

/** Skip the suggestion: adds nothing and does not touch Ready. */
export function skipWeather<T extends Trip>(trip: T): T {
  return trip.weather.status === "skipped"
    ? trip
    : { ...trip, weather: { ...trip.weather, status: "skipped" } };
}

/** Return to pending. Never adds or removes list items. */
export function reviewWeatherAgain<T extends Trip>(trip: T): T {
  return trip.weather.status === "pending"
    ? trip
    : { ...trip, weather: { ...trip.weather, status: "pending" } };
}

/**
 * Item identity invariants (plan §20.5): unique ids, no duplicated Bathroom / Pack last items,
 * no duplicated Nice accessories, no split Chargers collection. Returns human-readable violations.
 */
export function findIdentityViolations(trip: Pick<Trip, "items">): string[] {
  const violations: string[] = [];
  const duplicates = (values: string[]) =>
    values.filter((value, index) => values.indexOf(value) !== index);
  const names = (items: TripItem[]) => items.map((entry) => entry.name.trim().toLowerCase());

  for (const id of new Set(duplicates(trip.items.map((entry) => entry.id))))
    violations.push(`duplicate id: ${id}`);
  for (const name of new Set(
    duplicates(names(trip.items.filter((entry) => entry.groupId === TOILETRY_GROUP_ID))),
  ))
    violations.push(`duplicate Bathroom item: ${name}`);
  for (const name of new Set(
    duplicates(names(trip.items.filter((entry) => entry.section === "packlast"))),
  ))
    violations.push(`duplicate Pack last item: ${name}`);
  const accessoryKeys = trip.items.map((entry) => niceAccessoryKey(entry)).filter(Boolean);
  for (const key of new Set(duplicates(accessoryKeys)))
    violations.push(`duplicate Nice accessory: ${key}`);
  if (trip.items.filter((entry) => /\bchargers?\b/i.test(entry.name)).length > 1)
    violations.push("split Chargers");
  return violations;
}
