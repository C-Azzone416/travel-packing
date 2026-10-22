// Applying saved lists to a new trip (#140). Pure: a list is copied as a snapshot, so later edits to the list never
// reach the trip. Duplicates (same normalised name and category) are detected and reported, NOT resolved: the review
// step decides what to do with them.

import type { TripItem } from "./calc";

export interface SavedListItem {
  /** Stable identity within its list. */
  id: string;
  name: string;
  category: string;
  qty: number;
}

export interface SavedList {
  id: string;
  name: string;
  items: SavedListItem[];
}

/** A planned item for the new trip. Never packed. */
export interface PlannedItem extends TripItem {
  /** The saved list it came from. */
  listId: string;
}

export interface DuplicateGroup {
  /** The normalised name and category the members share. */
  key: string;
  /** Every planned item with that key, in apply order (draft items first, then lists in the order given). */
  items: PlannedItem[];
}

export interface ApplyResult {
  planned: PlannedItem[];
  duplicates: DuplicateGroup[];
}

/** Case, accent and whitespace-insensitive form of a name, used only to compare. */
export function normaliseName(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

export const duplicateKey = (name: string, category: string): string =>
  `${normaliseName(name)}\u0000${category}`;

/**
 * Plan the items a new trip gets from `lists`, given the draft items the trip already has. Planned items carry
 * packed = 0 and fresh ids (`saved:<listId>:<itemId>`); a planned item is reported as a duplicate when another
 * planned item or a draft item shares its normalised name and category. Nothing is merged or dropped.
 * `draft` items appear in a duplicate group when they match a planned one, but are not returned as planned.
 */
export function applySavedLists(
  draft: readonly TripItem[],
  lists: readonly SavedList[],
): ApplyResult {
  const planned: PlannedItem[] = [];
  for (const list of lists) {
    for (const item of list.items) {
      planned.push({
        id: `saved:${list.id}:${item.id}`,
        name: item.name,
        category: item.category,
        qty: item.qty,
        packed: 0,
        section: "main",
        listId: list.id,
      });
    }
  }

  const byKey = new Map<string, PlannedItem[]>();
  const draftAsPlanned = (item: TripItem): PlannedItem => ({
    ...item,
    packed: item.packed,
    listId: "",
  });
  for (const item of draft) {
    const key = duplicateKey(item.name, item.category);
    byKey.set(key, [...(byKey.get(key) ?? []), draftAsPlanned(item)]);
  }
  const hasDraft = new Set(byKey.keys());
  for (const item of planned) {
    const key = duplicateKey(item.name, item.category);
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [key, items] of byKey) {
    const plannedCount = items.filter((item) => item.listId !== "").length;
    if (plannedCount > 0 && (plannedCount > 1 || hasDraft.has(key)))
      duplicates.push({ key, items });
  }
  return { planned, duplicates };
}

// ---------------------------------------------------------------- managing lists (#167)

/** A list's name is compared case-, accent- and space-insensitively when checking it is unique per owner. */
export function listNameTaken(
  lists: readonly Pick<SavedList, "id" | "name">[],
  name: string,
  exceptId: string | null = null,
): boolean {
  const wanted = normaliseName(name);
  return lists.some((list) => list.id !== exceptId && normaliseName(list.name) === wanted);
}

/** The other item in this list with the same normalised name and category, if there is one. */
export function findListItemDuplicate(
  items: readonly SavedListItem[],
  name: string,
  category: string,
  exceptId: string | null = null,
): SavedListItem | null {
  const key = duplicateKey(name, category);
  return (
    items.find((item) => item.id !== exceptId && duplicateKey(item.name, item.category) === key) ??
    null
  );
}

export interface CategoryCount {
  category: string;
  count: number;
}

/** "Clothing 12 · Bathroom 7": the categories a list holds, biggest first (ties by name). */
export function categoryCounts(items: readonly SavedListItem[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
