import { TOILETRY_GROUP_ID } from "../toiletry-bag";
import { calculateSuggestions, type CalcConfig, type WeatherInput } from "./suggestions";

export type StapleCadence = "per day" | "per trip";
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
}

export interface TripItems {
  days: number;
  dailyDays: number;
  items: TripItem[];
}

// Future-trip defaults, from the prototype's initialStaples (app.js).
export const DEFAULT_STAPLES: readonly Staple[] = [
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

// Seeded in every new trip's Pack last section (doc §6). Chargers is one
// collective item; Everyday glasses is not Sunglasses.
export const DEFAULT_PACK_LAST: readonly { id: string; name: string }[] = [
  { id: "last-laptop", name: "Laptop" },
  { id: "last-chargers", name: "Chargers" },
  { id: "last-glasses", name: "Everyday glasses" },
];

export type NiceAccessoryKey = "makeup" | "dress-shoes" | "dress-undergarments" | "";

// Items with equivalent semantics dedupe by name, so a "Makeup" staple replaces
// the calculated "Makeup" suggestion instead of duplicating it.
export function niceAccessoryKey(entry: { name?: string | null }): NiceAccessoryKey {
  const name = String(entry.name ?? "").toLowerCase();
  if (name.includes("makeup") || name.includes("make-up")) return "makeup";
  if (name.includes("dress") && name.includes("shoe")) return "dress-shoes";
  if (name.includes("dress") && name.includes("undergarment")) return "dress-undergarments";
  return "";
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

// Builds a new trip's item list: calculated suggestions, default Sunglasses,
// the four-item return outfit, default Pack last items, then the staples merged
// over them. A matching staple REPLACES the calculated item's qty (never sums),
// and spare adds +1 on top for the underwear and socks staples only.
export function buildTripItems(
  config: CalcConfig,
  staples: readonly Staple[],
  weather?: WeatherInput,
): TripItems {
  const computed = calculateSuggestions(config, weather);

  const items: TripItem[] = computed.items.map((entry) => {
    const suggested = newItem(entry.id, entry.name, entry.category, entry.qty, "main");
    suggested.optional = Boolean(entry.optional);
    if (entry.id === "nice-makeup") suggested.groupId = TOILETRY_GROUP_ID;
    if (entry.groupId) suggested.groupId = entry.groupId;
    return suggested;
  });
  items.push(newItem("sunglasses", "Sunglasses", "Accessories", 1, "main"));
  if (config.returnOutfit !== false) items.push(...returnOutfitItems());
  for (const entry of DEFAULT_PACK_LAST) {
    items.push(newItem(entry.id, entry.name, "Pack last", 1, "packlast"));
  }

  for (const staple of staples) {
    let qty = staple.cadence === "per day" ? computed.dailyDays * staple.qty : staple.qty;
    if ((staple.id === "underwear" || staple.id === "socks") && config.spare) qty += 1;
    const key = niceAccessoryKey(staple);
    const existing = items.find(
      (entry) => entry.id === staple.id || (key !== "" && niceAccessoryKey(entry) === key),
    );
    if (qty <= 0 && !existing) continue;
    const groupId = key === "makeup" ? TOILETRY_GROUP_ID : staple.groupId || null;
    if (existing) {
      if (existing.id !== staple.id && key !== "") existing.id = staple.id;
      existing.name = staple.name;
      existing.category = staple.category;
      existing.qty = qty;
      if (existing.section !== "return") existing.section = staple.packLast ? "packlast" : "main";
      existing.groupId = groupId;
    } else {
      const added = newItem(
        staple.id,
        staple.name,
        staple.category,
        qty,
        staple.packLast ? "packlast" : "main",
      );
      added.groupId = groupId;
      items.push(added);
    }
  }

  return { days: computed.days, dailyDays: computed.dailyDays, items };
}
