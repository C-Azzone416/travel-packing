import { canonicalItemId } from "../item-identity";
import { TOILETRY_GROUP_ID } from "../toiletry-bag";
import { calculateSuggestions, type CalcConfig, type WeatherInput } from "./suggestions";

export type StapleCadence = "per day" | "per trip" | "smart";
export type ItemSection = "main" | "packlast" | "return";

export interface Staple {
  id: string;
  name: string;
  qty: number;
  cadence: StapleCadence;
  category: string;
  packLast: boolean;
  groupId?: string;
}

export interface TripItem {
  id: string;
  name: string;
  category: string;
  qty: number;
  packed: number;
  section: ItemSection;
  optional?: boolean;
  groupId?: string | null;
  /** Saved with the trip so preference recalculation never reads later account defaults. */
  stapleCadence?: StapleCadence;
}

export interface TripItems {
  days: number;
  dailyDays: number;
  items: TripItem[];
}

/** Synthetic preview/test data. The application never inserts this set for a real account. */
export const SYNTHETIC_STAPLES: readonly Staple[] = [
  {
    id: "underwear",
    name: "Underwear",
    qty: 1,
    cadence: "per day",
    category: "Clothing",
    packLast: false,
  },
  { id: "socks", name: "Socks", qty: 1, cadence: "per day", category: "Clothing", packLast: false },
  {
    id: "sleepwear",
    name: "Sleepwear",
    qty: 1,
    cadence: "per trip",
    category: "Clothing",
    packLast: false,
  },
  {
    id: "last-toothbrush",
    name: "Toothbrush",
    qty: 1,
    cadence: "per trip",
    category: "Bathroom",
    packLast: true,
    groupId: TOILETRY_GROUP_ID,
  },
  {
    id: "last-toothpaste",
    name: "Toothpaste",
    qty: 1,
    cadence: "per trip",
    category: "Bathroom",
    packLast: true,
    groupId: TOILETRY_GROUP_ID,
  },
  {
    id: "last-deodorant",
    name: "Deodorant",
    qty: 1,
    cadence: "per trip",
    category: "Bathroom",
    packLast: true,
    groupId: TOILETRY_GROUP_ID,
  },
  {
    id: "last-contacts",
    name: "Contacts",
    qty: 1,
    cadence: "per trip",
    category: "Bathroom",
    packLast: true,
    groupId: TOILETRY_GROUP_ID,
  },
  {
    id: "last-laptop",
    name: "Laptop",
    qty: 1,
    cadence: "per trip",
    category: "Tech",
    packLast: true,
  },
  {
    id: "last-chargers",
    name: "Chargers",
    qty: 1,
    cadence: "per trip",
    category: "Tech",
    packLast: true,
  },
  {
    id: "sunglasses",
    name: "Sunglasses",
    qty: 1,
    cadence: "per trip",
    category: "Other essentials",
    packLast: false,
  },
  {
    id: "last-glasses",
    name: "Everyday glasses",
    qty: 1,
    cadence: "per trip",
    category: "Other essentials",
    packLast: true,
  },
];

/** Clothing identities whose Smart quantity is defined by the canonical trip calculator. */
export const SMART_STAPLE_IDS: ReadonlySet<string> = new Set([
  "tops",
  "bottoms",
  "underwear",
  "socks",
  "sleepwear",
  "nice-top",
  "nice-bottom",
  "nice-shoes",
]);

export function supportsSmartQuantity(semanticId: string): boolean {
  return SMART_STAPLE_IDS.has(canonicalItemId(semanticId));
}

function newItem(
  id: string,
  name: string,
  category: string,
  qty: number,
  section: ItemSection,
): TripItem {
  return { id, name, category, qty, packed: 0, section };
}

function returnOutfitItems(): TripItem[] {
  return [
    newItem("return-top", "Fresh top", "Return outfit", 1, "return"),
    newItem("return-bottoms", "Bottoms", "Return outfit", 1, "return"),
    newItem("return-underwear", "Underwear", "Return outfit", 1, "return"),
    newItem("return-socks", "Socks", "Return outfit", 1, "return"),
  ];
}

function smartQuantity(staple: Staple, config: CalcConfig): number {
  const identity = canonicalItemId(staple.id);
  if (!supportsSmartQuantity(identity)) {
    throw new RangeError(`Smart quantity is not supported for ${identity}`);
  }
  return (
    calculateSuggestions(config).items.find((entry) => canonicalItemId(entry.id) === identity)
      ?.qty ?? 0
  );
}

/** Weather-aware clothing rows are alternate presentations of the same Smart clothing families. */
const WEATHER_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  tops: ["tops-short", "tops-long"],
  bottoms: ["bottoms-shorts", "bottoms-pants"],
};

/**
 * Build a new trip from generic outfit recommendations and the owner's selected Staples.
 * Staples have deterministic precedence over a recommendation with the same semantic identity;
 * quantities are never summed and every new row starts unpacked.
 */
export function buildTripItems(
  config: CalcConfig,
  staples: readonly Staple[],
  weather?: WeatherInput,
): TripItems {
  const computed = calculateSuggestions(config, weather);
  const items: TripItem[] = computed.items.map((entry) => ({
    ...newItem(entry.id, entry.name, entry.category, entry.qty, "main"),
    ...(entry.optional ? { optional: true } : {}),
    ...(entry.groupId ? { groupId: entry.groupId } : {}),
  }));
  if (config.returnOutfit !== false) items.push(...returnOutfitItems());

  for (const staple of staples) {
    const identity = canonicalItemId(staple.id);
    // Return-outfit rows are a separate trip feature, not personal Staples. A corrupt/legacy collision must not
    // create duplicate ids or turn the return row into an ordinary packing row.
    if (items.some((entry) => entry.section === "return" && entry.id === staple.id)) continue;

    const qty =
      staple.cadence === "per day"
        ? computed.days * staple.qty
        : staple.cadence === "smart"
          ? smartQuantity(staple, config)
          : staple.qty;

    const weatherVariants = WEATHER_VARIANTS[identity];
    if (weatherVariants) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (weatherVariants.includes(items[index].id)) items.splice(index, 1);
      }
    }
    const existing = items.find(
      (entry) => entry.section !== "return" && canonicalItemId(entry.id) === identity,
    );
    if (qty <= 0 && !existing) continue;

    const values = {
      id: staple.id,
      name: staple.name,
      category: staple.category,
      qty,
      section: staple.packLast ? ("packlast" as const) : ("main" as const),
      groupId: staple.groupId ?? null,
      stapleCadence: staple.cadence,
    };
    if (existing) Object.assign(existing, values);
    else items.push({ ...values, packed: 0 });
  }

  return { days: computed.days, dailyDays: computed.dailyDays, items };
}
