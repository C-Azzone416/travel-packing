import { canCarryLaundryFlag, cubeForItem, type Cube } from "../cubes";
import { canonicalItemId } from "../item-identity";
import { TOILETRY_GROUP_ID } from "../toiletry-bag";
import { calculateSuggestions, type CalcConfig, type WeatherInput } from "./suggestions";

/**
 * How a Staple scales. "smart" is legacy (#378): old trip snapshots and the occasion-driven Nice attire Staples keep it,
 * everything else was migrated to "per day" plus the laundry flag.
 */
export type StapleCadence = "per day" | "per trip" | "smart" | "per night";
export type ItemSection = "main" | "packlast" | "return";

export interface Staple {
  id: string;
  name: string;
  qty: number;
  cadence: StapleCadence;
  category: string;
  packLast: boolean;
  groupId?: string;
  /** "↻ Fewer with laundry": halves the quantity, rounding up, when the trip has laundry. Never on underwear or socks. */
  laundryHalves?: boolean;
  /** Where the Staple lives in the suitcase. Absent: the cube its category implies. */
  cube?: Cube;
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
  /** The Staple's per-unit quantity and effective laundry flag, saved with the row so a recalculation can re-derive it. */
  stapleQty?: number;
  laundryHalves?: boolean;
  /** The suitcase cube. Absent: the cube the category implies (`itemCube`). A person can move an item to another cube. */
  cube?: Cube;
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
  return { id, name, category, qty, packed: 0, section, cube: cubeForItem({ id, name, category }) };
}

/** What a trip offers a Staple's cadence: the day counts the calculator already uses, and the trip's preferences. */
export interface StapleQuantityContext {
  days: number;
  nights: number;
  dailyDays: number;
  laundry: boolean;
  spare: boolean;
}

/** Clothing families whose "per day" means everyday outfits (#295), the same count the old Smart quantities used. */
const OUTFIT_FAMILY_IDS: ReadonlySet<string> = new Set(["tops", "bottoms", "underwear", "socks"]);

/**
 * The quantity a non-Smart Staple resolves to on a trip. "per day" is the trip's days (travel days included, #222), except
 * the everyday-outfit families, which use the everyday-outfit count (days - 1 with a return outfit) and, for underwear and
 * socks, one spare when the trip has one. "per night" is the nights. The laundry flag halves the result, rounding up
 * (5 -> 3, 11 -> 6) when the trip has laundry; underwear and socks never halve, whatever the flag says.
 */
export function stapleQuantity(
  staple: Pick<Staple, "id" | "qty" | "cadence" | "laundryHalves">,
  context: StapleQuantityContext,
): number {
  const identity = canonicalItemId(staple.id);
  let qty: number;
  if (staple.cadence === "per night") qty = context.nights * staple.qty;
  else if (staple.cadence === "per day") {
    qty = (OUTFIT_FAMILY_IDS.has(identity) ? context.dailyDays : context.days) * staple.qty;
  } else qty = staple.qty;
  if (staple.laundryHalves && context.laundry && canCarryLaundryFlag(staple.id)) {
    qty = Math.ceil(qty / 2);
  }
  if (staple.cadence === "per day" && !canCarryLaundryFlag(staple.id) && context.spare) qty += 1;
  return qty;
}

export function stapleContext(
  config: Pick<CalcConfig, "laundry" | "spare">,
  counts: { days: number; nights: number; dailyDays: number },
): StapleQuantityContext {
  return { ...counts, laundry: Boolean(config.laundry), spare: Boolean(config.spare) };
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
  // A day trip has no return outfit: you are home the same day (#412). Existing trips keep the rows they already have.
  if (config.returnOutfit !== false && computed.days > 1) items.push(...returnOutfitItems());

  for (const staple of staples) {
    const identity = canonicalItemId(staple.id);
    // Return-outfit rows are a separate trip feature, not personal Staples. A corrupt/legacy collision must not
    // create duplicate ids or turn the return row into an ordinary packing row.
    if (items.some((entry) => entry.section === "return" && entry.id === staple.id)) continue;

    const context = stapleContext(config, computed);
    const qty =
      staple.cadence === "smart" ? smartQuantity(staple, config) : stapleQuantity(staple, context);

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
      cube: staple.cube ?? cubeForItem(staple),
      ...(staple.cadence === "smart"
        ? {}
        : {
            stapleQty: staple.qty,
            laundryHalves: Boolean(staple.laundryHalves) && canCarryLaundryFlag(staple.id),
          }),
    };
    if (existing) Object.assign(existing, values);
    else items.push({ ...values, packed: 0 });
  }

  return { days: computed.days, dailyDays: computed.dailyDays, items };
}
