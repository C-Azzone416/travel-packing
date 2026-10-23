// What changing the packing preferences would do to a trip's list, before it is applied (#203). Pure.
//
// This module adds no merge rules. It runs `recalculateSuggestions`, the one thing that ever rewrites a list after a preference
// change, and describes the difference between the list before and after, so the preview cannot disagree with the result.
// The rules it shows (all in item-ops.ts): manual, weather and saved-list items are never touched; a user-edited suggestion keeps its
// own name, quantity and section; an untouched suggestion takes the new quantity; a packed count becomes min(packed, new quantity),
// the only thing that lowers one; a suggestion the new preferences drop is remembered and comes back, with its edits and packed
// count, when the preference does; a suppressed optional suggestion is not re-added; Ready is revoked; the bag placement resets
// only when the Bathroom contents change.

import { CALCULATED_ITEM_IDS, recalculateSuggestions } from "./item-ops";
import { toiletryItems } from "./toiletry-bag";
import type { SuggestFn, Trip, TripConfig } from "./trip";

export interface UpdatedLine {
  id: string;
  name: string;
  fromQty: number;
  toQty: number;
  /** Set only when the packed count is lowered to the new target: min(packed, new quantity). */
  packedFrom?: number;
  packedTo?: number;
}

export interface RemovedLine {
  id: string;
  name: string;
  qty: number;
  packed: number;
  edited: boolean;
}

export interface AddedLine {
  id: string;
  name: string;
  qty: number;
  optional: boolean;
}

export type StayReason = "added by you" | "edited by you" | "unchanged";

export interface StayLine {
  id: string;
  name: string;
  why: StayReason;
}

export interface RecalcPreview<T extends Trip = Trip> {
  /** The trip exactly as applying the change produces it (the same call the server makes). */
  next: T;
  updated: UpdatedLine[];
  removed: RemovedLine[];
  added: AddedLine[];
  /** Everything that stays as it is, with why. Includes the manual, edited, weather, saved-list and unchanged lines. */
  stays: StayLine[];
  /** Optional suggestions the person removed on purpose: not re-added. */
  suppressed: { id: string; name: string }[];
  /** Packed counts the change lowers (a subset of `updated`). */
  packedReduced: { id: string; name: string; from: number; to: number }[];
  /** True when applying costs packed progress or edits: a packed count drops, or a packed or edited line is removed. */
  needsAcknowledgement: boolean;
  /** The trip is Ready now, and applying turns it off. */
  readyWillRevoke: boolean;
  /** The toiletry bag was placed, and the Bathroom contents change, so placement resets. */
  bagWillReset: boolean;
  /** The Bathroom lines added or removed, for the bag note. */
  bathroomChanges: string[];
  /** Whether the preferences differ at all. */
  configChanged: boolean;
}

const CONFIG_KEYS: (keyof TripConfig)[] = [
  "laundry",
  "spare",
  "niceAttire",
  "occasionCount",
  "reuseNice",
  "returnOutfit",
];

export function configsEqual(a: TripConfig, b: TripConfig): boolean {
  return CONFIG_KEYS.every((key) => a[key] === b[key]);
}

export function previewRecalculation<T extends Trip>(
  trip: T,
  nextConfig: TripConfig,
  suggest: SuggestFn,
): RecalcPreview<T> {
  const next = recalculateSuggestions(trip, nextConfig, suggest);
  const before = new Map(trip.items.map((item) => [item.id, item]));
  const after = new Map(next.items.map((item) => [item.id, item]));

  const updated: UpdatedLine[] = [];
  const removed: RemovedLine[] = [];
  const added: AddedLine[] = [];
  const stays: StayLine[] = [];
  const packedReduced: RecalcPreview["packedReduced"] = [];

  for (const old of trip.items) {
    const kept = after.get(old.id);
    if (!kept) {
      // Only calculated suggestions can leave the list; a manual item never does.
      removed.push({
        id: old.id,
        name: old.name,
        qty: old.qty,
        packed: old.packed,
        edited: Boolean(old.userEdited),
      });
      continue;
    }
    if (!CALCULATED_ITEM_IDS.has(old.id)) {
      stays.push({ id: old.id, name: old.name, why: "added by you" });
      continue;
    }
    if (old.userEdited) {
      stays.push({ id: old.id, name: kept.name, why: "edited by you" });
      continue;
    }
    if (kept.qty !== old.qty || kept.packed !== old.packed) {
      const line: UpdatedLine = { id: old.id, name: kept.name, fromQty: old.qty, toQty: kept.qty };
      if (kept.packed < old.packed) {
        line.packedFrom = old.packed;
        line.packedTo = kept.packed;
        packedReduced.push({ id: old.id, name: kept.name, from: old.packed, to: kept.packed });
      }
      updated.push(line);
    } else {
      stays.push({ id: old.id, name: old.name, why: "unchanged" });
    }
  }
  for (const item of next.items) {
    if (before.has(item.id)) continue;
    added.push({ id: item.id, name: item.name, qty: item.qty, optional: Boolean(item.optional) });
  }

  const calculatedNames = new Map(
    suggest({ ...nextConfig, start: trip.start, end: trip.end }).items.map((item) => [
      item.id,
      item.name,
    ]),
  );
  const suppressed = Object.keys(trip.suppressedSuggestions)
    .filter((id) => trip.suppressedSuggestions[id])
    .map((id) => ({
      id,
      name: calculatedNames.get(id) ?? trip.suggestionMemory[id]?.name ?? id,
    }));

  const bagBefore = new Map(toiletryItems(trip).map((item) => [item.id, item.qty]));
  const bagAfter = new Map(toiletryItems(next).map((item) => [item.id, item.qty]));
  const bathroomChanges: string[] = [];
  for (const [id, qty] of bagAfter) {
    const name = after.get(id)?.name ?? id;
    if (!bagBefore.has(id)) bathroomChanges.push(`+${name}`);
    else if (bagBefore.get(id) !== qty)
      bathroomChanges.push(`${name} ${bagBefore.get(id)} → ${qty}`);
  }
  for (const [id] of bagBefore) {
    if (!bagAfter.has(id)) bathroomChanges.push(`−${before.get(id)?.name ?? id}`);
  }

  const lostWork = removed.some((line) => line.packed > 0 || line.edited);
  return {
    next,
    updated,
    removed,
    added,
    stays,
    suppressed,
    packedReduced,
    needsAcknowledgement: packedReduced.length > 0 || lostWork,
    readyWillRevoke: Boolean(trip.ready),
    bagWillReset: Boolean(trip.toiletryBagPacked) && bathroomChanges.length > 0,
    bathroomChanges,
    configChanged: !configsEqual(trip.config, nextConfig),
  };
}
