// Suitcase cubes (#378, epic #375). Pure; no framework imports.
//
// A cube is where an item lives in the suitcase. Categories stay on items for compatibility, but cubes now drive
// display and grouping. The category -> cube rules here are mirrored by the SQL backfill in migration 0014
// (a PGlite test runs the SQL against the same fixtures, so the two cannot drift apart).

import { canonicalItemId } from "./item-identity";
import { TOILETRY_GROUP_ID } from "./toiletry-bag";

export const CUBES = ["clothing", "toiletries", "tech", "documents", "misc", "weather"] as const;
export type Cube = (typeof CUBES)[number];

export const CUBE_LABELS: Readonly<Record<Cube, string>> = {
  clothing: "Clothing",
  toiletries: "Toiletries",
  tech: "Tech",
  documents: "Documents",
  misc: "Misc",
  weather: "Weather gear",
};

/** The cube whose items are packed the morning of departure on every new trip (the toiletry bag). */
export const DEFAULT_MORNING_OF_CUBES: readonly Cube[] = ["toiletries"];

/** Staples that can never carry the "fewer with laundry" flag: one underwear and one pair of socks per day, always. */
export const NEVER_LAUNDRY_IDS: readonly string[] = ["underwear", "socks"];

export function isCube(value: unknown): value is Cube {
  return typeof value === "string" && (CUBES as readonly string[]).includes(value);
}

export function canCarryLaundryFlag(semanticId: string): boolean {
  return !NEVER_LAUNDRY_IDS.includes(canonicalItemId(semanticId));
}

export interface CubeSource {
  id: string;
  name?: string;
  category: string;
  groupId?: string | null;
}

/** Words that make an "Other essentials" item a document. Migration 0014 uses the same list. */
export const DOCUMENT_WORDS: readonly string[] = [
  "passport",
  "document",
  "licen[cs]e",
  "ticket",
  "visa",
  "insurance",
  "boarding",
  "itinerary",
  "reservation",
  "booking",
  "vaccin",
];
/** Words that make a "Pack last" (or unknown-category) item Tech. */
export const TECH_WORDS: readonly string[] = [
  "laptop",
  "charger",
  "phone",
  "cable",
  "adapter",
  "headphone",
  "earbud",
  "camera",
  "tablet",
  "power bank",
];
const DOCUMENT_REGEX = new RegExp(`${DOCUMENT_WORDS.join("|")}|\\bid\\b`, "i");
const TECH_REGEX = new RegExp(TECH_WORDS.join("|"), "i");

function documentOrMisc(source: CubeSource): Cube {
  return DOCUMENT_REGEX.test(`${source.id} ${source.name ?? ""}`) ? "documents" : "misc";
}

/**
 * The cube an item belongs in, from its category and identity.
 * Toiletry-bag contents always go to Toiletries; weather-driven items (category "Weather suggestion" or a
 * canonical `weather-*` identity) go to the weather cube; "Other essentials" are Documents only when they look
 * like documents, otherwise Misc; "Pack last" has no cube of its own, so the item is sorted by what it is.
 */
export function cubeForItem(source: CubeSource): Cube {
  if (source.groupId === TOILETRY_GROUP_ID) return "toiletries";
  if (canonicalItemId(source.id).startsWith("weather-")) return "weather";
  switch (source.category) {
    case "Clothing":
    case "Nice attire":
    case "Return outfit":
      return "clothing";
    case "Bathroom":
    case "Toiletries":
      return "toiletries";
    case "Tech":
      return "tech";
    case "Other essentials":
      return documentOrMisc(source);
    case "Accessories":
      return "misc";
    case "Weather suggestion":
      return "weather";
    default:
      // "Pack last" and anything unknown: sort by what the item is.
      return TECH_REGEX.test(`${source.id} ${source.name ?? ""}`) ? "tech" : documentOrMisc(source);
  }
}

/** An item's cube: the one it was given (a person can move an item), else the one its category implies. */
export function itemCube(item: CubeSource & { cube?: Cube }): Cube {
  return item.cube ?? cubeForItem(item);
}

/** The label for the weather cube, named for the condition that put things in it ("Rain gear"). */
export function weatherCubeLabel(ids: readonly string[]): string {
  const have = new Set(ids.map(canonicalItemId));
  if (["weather-umbrella", "weather-rain-jacket"].some((id) => have.has(id))) return "Rain gear";
  if (have.has("weather-snow-boots")) return "Snow gear";
  if (["weather-sunscreen", "weather-sun-hat", "weather-swimsuit"].some((id) => have.has(id))) {
    return "Sun gear";
  }
  return CUBE_LABELS.weather;
}

/**
 * Cubes flagged "Morning of" for a trip: the saved flags (Toiletries by default) plus the cube of every
 * "Pack last" item, so a Pack last item keeps a real cube and that cube is flagged. Returned in cube order.
 */
export function morningOfCubesFor(
  items: readonly (CubeSource & { cube?: Cube; section?: string })[],
  saved?: readonly Cube[],
): Cube[] {
  const flagged = new Set<Cube>(saved ?? DEFAULT_MORNING_OF_CUBES);
  for (const item of items) if (item.section === "packlast") flagged.add(itemCube(item));
  return CUBES.filter((cube) => flagged.has(cube));
}
