// Input validation for every data-layer entry point. Strings are bounded, enums are closed, and ids are uuids,
// so nothing unexpected reaches the domain or the database.

import { z } from "zod";
import { ITEM_CATEGORIES, TOILETRY_GROUP } from "../db/schema";

export const tripId = z.uuid();
export const itemId = z.string().min(1).max(100);
export const scope = z.enum(["this-trip", "remember"]);
export const timing = z.enum(["main", "return", "packlast"]);
const name = z.string().trim().min(1).max(120);
const qty = z.number().int().min(1).max(999);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const tripConfig = z.object({
  laundry: z.boolean(),
  spare: z.boolean(),
  niceAttire: z.boolean(),
  occasionCount: z.number().int().min(1).max(8),
  reuseNice: z.boolean(),
  returnOutfit: z.boolean(),
});

export const sampleLocation = z.object({
  id: z.string().min(1).max(60),
  city: z.string().min(1).max(80),
  region: z.string().max(80),
  country: z.string().min(1).max(80),
  countryCode: z.string().length(2),
  label: z.string().min(1).max(240),
});

export const dates = z.object({ start: isoDate, end: isoDate });

export const tripOnly = z.object({ tripId });
export const tripItem = z.object({ tripId, itemId });
export const setPackedInput = z.object({
  tripId,
  itemId,
  packed: z.number().int().min(0).max(999),
});
export const editItemInput = z.object({ tripId, itemId, name, qty, timing, scope });
export const removeItemInput = z.object({ tripId, itemId, scope });
export const addToiletryItemInput = z.object({
  tripId,
  name,
  qty,
  packLast: z.boolean(),
  scope,
});
export const updatePreferencesInput = z.object({ tripId, config: tripConfig });

export const createTripInput = z.object({
  location: sampleLocation,
  ...dates.shape,
  config: tripConfig,
});
export const copyTripInput = z.object({
  sourceId: tripId,
  location: sampleLocation,
  ...dates.shape,
});

export const stapleInput = z.object({
  semanticId: z.string().min(1).max(100),
  name,
  category: z.enum(ITEM_CATEGORIES),
  qty,
  cadence: z.enum(["per day", "per trip"]),
  packLast: z.boolean(),
  groupId: z.literal(TOILETRY_GROUP).optional(),
});

export const none = z.object({}).strict();
