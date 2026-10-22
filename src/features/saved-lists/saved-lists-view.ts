// Pure view helpers for the Saved lists pages (#167).

import type { CategoryCount } from "@/domain/saved-lists";

const DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

/** "12 Oct" for an ISO timestamp, in the person's own time zone. */
export function updatedText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

export const itemsLabel = (count: number): string => `${count} ${count === 1 ? "item" : "items"}`;

/** "Clothing 12 · Bathroom 7 · Tech 5 · +2 more": the biggest three categories, then how many others. */
export function categorySummary(categories: readonly CategoryCount[], show = 3): string {
  const shown = categories.slice(0, show).map((entry) => `${entry.category} ${entry.count}`);
  const rest = categories.length - show;
  return rest > 0 ? [...shown, `+${rest} more`].join(" · ") : shown.join(" · ");
}

/** The categories a person can pick for a list item: the ones they can add to a trip, plus Bathroom. */
export const LIST_CATEGORIES = [
  "Clothing",
  "Nice attire",
  "Bathroom",
  "Tech",
  "Other essentials",
  "Accessories",
] as const;

/** The select's options: the standard ones, plus the item's own category when it is something else (e.g. from a trip). */
export function categoryOptions(current: string | null): string[] {
  const base: string[] = [...LIST_CATEGORIES];
  return current && !base.includes(current) ? [...base, current] : base;
}

export interface Grouped<T> {
  category: string;
  rows: T[];
}

/** Rows grouped by category, in the standard order first then any others alphabetically; rows keep their list order. */
export function groupByCategory<T extends { category: string }>(rows: readonly T[]): Grouped<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const row of rows)
    byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  const order = (category: string) => {
    const index = (LIST_CATEGORIES as readonly string[]).indexOf(category);
    return index === -1 ? LIST_CATEGORIES.length : index;
  };
  return [...byCategory]
    .map(([category, entries]) => ({ category, rows: entries }))
    .sort((a, b) => order(a.category) - order(b.category) || a.category.localeCompare(b.category));
}
