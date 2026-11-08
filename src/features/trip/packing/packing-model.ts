// Pure view logic for the laptop Packing view (#385, spec on #376 part 3 section 1.3 and section 2). No React, no clock.
//
// Counting rule (PM decision on #376): every count is QUANTITY. A cube's n/m, "41 of 58 in the bag" and "17 to go" add up
// `min(packed, qty)` over `qty`; one tick sets packed = qty. Weather suggestions that were not added are not items yet, so
// they never reach these functions. The filter pills are the exception: they count ROWS (the items the filter lists).

import {
  CUBE_LABELS,
  isCube,
  itemCube,
  morningOfCubesFor,
  weatherCubeLabel,
  type Cube,
} from "@/domain/cubes";
import { canonicalItemId } from "@/domain/item-identity";
import { isDayTrip } from "@/domain/short-trip";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { WeatherChange } from "@/domain/weather/diff";

/** Where the rail lists the cubes: the weather cube sits third, as in the renders. */
export const PACKING_CUBE_ORDER: readonly Cube[] = [
  "clothing",
  "toiletries",
  "weather",
  "tech",
  "documents",
  "misc",
];
/** These two are always drawn, even empty ("Nothing here yet."). Every other cube is drawn only while it holds an item. */
const ALWAYS_DRAWN: readonly Cube[] = ["clothing", "misc"];

export type CubeFilter = "all" | "to-pack" | "packed";

export const isPacked = (item: Pick<TripItem, "packed" | "qty">): boolean =>
  item.packed >= item.qty;

export interface Count {
  packed: number;
  total: number;
}

/** Quantity packed and quantity wanted over some items. Over-packed rows (packed > qty) count as full. */
export function quantityCount(items: readonly Pick<TripItem, "packed" | "qty">[]): Count {
  return items.reduce<Count>(
    (sum, item) => ({
      packed: sum.packed + Math.min(Math.max(item.packed, 0), item.qty),
      total: sum.total + item.qty,
    }),
    { packed: 0, total: 0 },
  );
}

export interface CubeView {
  cube: Cube;
  /** "Clothing", or "Rain gear" for the weather cube. */
  label: string;
  items: TripItem[];
  packed: number;
  total: number;
  morningOf: boolean;
  /** The "Morning of" switch is offered: not on a day trip, where you are home the same day (#412). */
  morningOfAvailable: boolean;
  /** One short line under the bar (Documents: "passport ✓"); null when the cube has none. */
  note: string | null;
  /** The weather cube holds an item that is not packed yet: the bar and note turn to the accent. */
  alert: boolean;
}

/** The note rules that can be decided from what the app knows today (the adapter and 3.4 oz notes need data it lacks). */
export function cubeNote(cube: Cube, items: readonly TripItem[]): string | null {
  if (cube !== "documents") return null;
  const passport = items.find((item) => canonicalItemId(item.id) === "passport");
  if (!passport) return null;
  return isPacked(passport) ? "passport ✓" : "passport";
}

/** The cubes to draw, in rail order, with their counts. A cube with no items is left out unless it is Clothing or Misc. */
export function buildCubeViews(trip: LifecycleTrip): CubeView[] {
  const dayTrip = isDayTrip(trip);
  const flagged = new Set(dayTrip ? [] : morningOfCubesFor(trip.items, trip.morningOfCubes));
  const byCube = new Map<Cube, TripItem[]>();
  for (const item of trip.items) {
    const cube = itemCube(item);
    byCube.set(cube, [...(byCube.get(cube) ?? []), item]);
  }
  return PACKING_CUBE_ORDER.filter((cube) => byCube.has(cube) || ALWAYS_DRAWN.includes(cube)).map(
    (cube) => {
      const items = byCube.get(cube) ?? [];
      const { packed, total } = quantityCount(items);
      return {
        cube,
        label:
          cube === "weather" ? weatherCubeLabel(items.map((item) => item.id)) : CUBE_LABELS[cube],
        items,
        packed,
        total,
        morningOf: flagged.has(cube),
        morningOfAvailable: !dayTrip,
        note: cubeNote(cube, items),
        alert: cube === "weather" && items.some((item) => !isPacked(item)),
      };
    },
  );
}

export interface Headline extends Count {
  toGo: number;
  percent: number;
}

/** "41 of 58 in the bag" and "17 to go": every row of every cube, by quantity. */
export function headline(trip: Pick<LifecycleTrip, "items">): Headline {
  const { packed, total } = quantityCount(trip.items);
  return {
    packed,
    total,
    toGo: total - packed,
    percent: total ? Math.round((packed / total) * 100) : 0,
  };
}

export interface FilterCounts {
  all: number;
  toPack: number;
  packed: number;
}

/** The pill counts for one cube: how many rows each filter lists. */
export function filterCounts(items: readonly TripItem[]): FilterCounts {
  const packed = items.filter(isPacked).length;
  return { all: items.length, toPack: items.length - packed, packed };
}

export function filterItems(items: readonly TripItem[], filter: CubeFilter): TripItem[] {
  if (filter === "to-pack") return items.filter((item) => !isPacked(item));
  if (filter === "packed") return items.filter(isPacked);
  return [...items];
}

/** The footer of the open cube: the hint, or what a finished or empty view says. */
export function panelFooter(
  view: Pick<CubeView, "items"> & { morningOfAvailable?: boolean },
  shown: number,
): string {
  if (view.items.length === 0) return "Nothing here yet.";
  if (shown === 0) return "Nothing here.";
  if (view.items.every(isPacked)) return "Everything in this cube is packed.";
  return view.morningOfAvailable === false ? HINT_DAY_TRIP : HINT;
}

export const HINT =
  "Tick as you pack. “Edit list” adds items, moves them to another cube, or marks a cube for the morning you leave.";

/** The same hint on a day trip, which has no "Morning of" (#412). */
export const HINT_DAY_TRIP =
  "Tick as you pack. “Edit list” adds items or moves them to another cube.";

/** "Socks, 11": the name a checkbox announces (the count is part of it only when there is more than one). */
export function checkboxName(item: { name: string; qty: number; section?: string }): string {
  const named = item.qty > 1 ? `${item.name}, ${item.qty}` : item.name;
  return item.section === "return" ? `${named}, return outfit` : named;
}

/** The name a row's edit button announces: "Underwear", or "Underwear, return outfit" for the fresh set kept apart. */
export function editName(item: { name: string; section?: string }): string {
  return item.section === "return" ? `${item.name}, return outfit` : item.name;
}

/** "1 item" / "12 items". */
export const itemsLabel = (count: number): string => (count === 1 ? "1 item" : `${count} items`);

/** Which cubes the "move to" select offers for an item: the drawn cubes (the rule is on #393 section 3), minus its own. */
export function moveTargets(views: readonly CubeView[], from: Cube): CubeView[] {
  return views.filter((view) => view.cube !== from);
}

// ---------------------------------------------------------------- weather suggestions

export interface Suggestion {
  change: WeatherChange;
  /** "Rain shell". */
  name: string;
  /** The cube it would go to ("Rain gear"). */
  destination: string;
  /** The stop it belongs to (matched by the stop name in the reason), or null when the reason names none. */
  stopIndex: number | null;
  /** The button says "Remove" for a suggestion that takes something off the list. */
  verb: "Add" | "Remove";
}

/** The category a custom item gets when it is added from a cube (the cube itself is set explicitly on the item). */
export function categoryForCube(cube: Cube): string {
  switch (cube) {
    case "clothing":
      return "Clothing";
    case "tech":
      return "Tech";
    case "documents":
      return "Other essentials";
    default:
      return "Accessories";
  }
}

/** The cube named in `?cube=` (the Home tiles link here), or undefined for anything that is not a cube. */
export function cubeFromQuery(value: string | string[] | undefined): Cube | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return isCube(first) ? first : undefined;
}

/** "Rain likely in Lisbon, Oct 3–5": the stop whose name the reason mentions. */
export function stopIndexFor(reason: string, stopNames: readonly string[]): number | null {
  const found = stopNames.findIndex((name) => name && reason.includes(name));
  return found < 0 ? null : found;
}

/**
 * The pending weather changes as rows for the review region. A change that names no stop goes to the first stop with a
 * forecast (the caller passes `fallbackStop`), so every suggestion has exactly one card to open.
 */
export function toSuggestions(
  changes: readonly WeatherChange[],
  stopNames: readonly string[],
  fallbackStop: number,
  existingWeatherIds: readonly string[] = [],
): Suggestion[] {
  return changes.map((change) => {
    const named = stopIndexFor(change.reason, stopNames);
    if (change.kind === "add") {
      return {
        change,
        name: change.title,
        destination: weatherCubeLabel([...existingWeatherIds, change.semanticId]),
        stopIndex: named ?? fallbackStop,
        verb: "Add",
      };
    }
    if (change.kind === "remove") {
      return {
        change,
        name: change.title,
        destination: weatherCubeLabel(existingWeatherIds),
        stopIndex: named ?? fallbackStop,
        verb: "Remove",
      };
    }
    return {
      change,
      name: change.title,
      destination: CUBE_LABELS.clothing,
      stopIndex: named ?? fallbackStop,
      verb: "Add",
    };
  });
}
