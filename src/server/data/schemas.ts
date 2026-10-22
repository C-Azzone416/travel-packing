// Input validation for every data-layer entry point. Strings are bounded, enums are closed, and ids are uuids,
// so nothing unexpected reaches the domain or the database.

import { z } from "zod";
import { ADDABLE_CATEGORIES } from "../../domain/item-ops";
import { APPEARANCES } from "../../domain/appearance";
import { THEME_IDS } from "../../domain/themes";
import { MAX_STOPS } from "../../domain/trip-stops";
import { ITEM_CATEGORIES, TEMPERATURE_UNITS, TOILETRY_GROUP, WEATHER_STATUSES } from "../db/schema";

export const tripId = z.uuid();
/** The six built-in themes, and nothing else: an unknown value is INVALID_INPUT (#48). */
export const theme = z.enum(THEME_IDS);
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
/** A custom item of any addable category (#147). The domain checks the same limits again; this gives field errors. */
export const addItemInput = z.object({
  tripId,
  name,
  category: z.enum(ADDABLE_CATEGORIES),
  neededQty: qty,
});
// ---------------------------------------------------------------- saved lists (#167)
const savedListId = z.uuid();
const savedListName = z.string().trim().min(1).max(60);
const savedListItemName = z.string().trim().min(1).max(120);
const savedListQty = z.number().int().min(1).max(999);
export const savedListOnly = z.object({ listId: savedListId });
export const renameSavedListInput = z.object({ listId: savedListId, name: savedListName });
export const addSavedListItemInput = z.object({
  listId: savedListId,
  name: savedListItemName,
  category: z.enum(ITEM_CATEGORIES),
  qty: savedListQty,
});
export const updateSavedListItemInput = z.object({
  listId: savedListId,
  itemId: z.string().min(1).max(100),
  name: savedListItemName,
  category: z.enum(ITEM_CATEGORIES),
  qty: savedListQty,
});
export const removeSavedListItemInput = z.object({
  listId: savedListId,
  itemId: z.string().min(1).max(100),
});
export const saveTripAsListInput = z.object({
  tripId,
  name: savedListName,
  itemIds: z.array(z.string().min(1).max(100)).min(1).max(500),
});
export const updatePreferencesInput = z.object({ tripId, config: tripConfig });

/**
 * The browser's claim about a place is only its id. Anything else it sends (city, region, coordinates) is
 * stripped here and never trusted: the server resolves the canonical place from the id (#47).
 */
export const locationSelection = z.object({ id: z.string().min(1).max(60) });

/** One stop as the browser names it: a place id plus the arrive and leave dates. At most six per trip. */
export const stopSelection = z.object({
  location: locationSelection,
  arrive: isoDate,
  leave: isoDate,
});
export const stopsSelection = z.array(stopSelection).min(1).max(MAX_STOPS);

/**
 * A trip's route is either the single-destination form (`location` + `start` + `end`, as before) or `stops`.
 * Exactly one form is accepted; a missing field of the chosen form is reported at its own path.
 */
function oneRouteForm(
  value: { location?: unknown; start?: unknown; end?: unknown; stops?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (value.stops !== undefined) {
    for (const key of ["location", "start", "end"] as const) {
      if (value[key] !== undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "Use stops or location and dates" });
      }
    }
    return;
  }
  for (const key of ["location", "start", "end"] as const) {
    if (value[key] === undefined)
      ctx.addIssue({ code: "custom", path: [key], message: "Required" });
  }
}

const routeFields = {
  location: locationSelection.optional(),
  start: isoDate.optional(),
  end: isoDate.optional(),
  stops: stopsSelection.optional(),
};

export const createTripInput = z
  .object({
    ...routeFields,
    config: tripConfig,
    /** Travel when left out. */
    theme: theme.optional(),
    /** Start from this saved list instead of staples and recommendations (#170). Looked up by owner, never trusted. */
    savedListId: savedListId.optional(),
  })
  .superRefine(oneRouteForm);
export const copyTripInput = z
  .object({
    sourceId: tripId,
    ...routeFields,
    /** The source trip's theme when left out. */
    theme: theme.optional(),
  })
  .superRefine(oneRouteForm);
/** Replace the stops of a saved trip. */
export const setStopsInput = z.object({ tripId, stops: stopsSelection });
export const setThemeInput = z.object({ tripId, theme });

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

export const weatherSettingsInput = z
  .object({ weatherOptIn: z.boolean(), temperatureUnit: z.enum(TEMPERATURE_UNITS) })
  .partial();
export const appearanceInput = z.object({ appearance: z.enum(APPEARANCES) });
const semanticId = z.string().min(1).max(100);
export const weatherSuggestionInput = z.object({
  tripId,
  semanticId,
  status: z.enum(WEATHER_STATUSES),
  /** A short rule signature, never raw weather. */
  ruleSignature: z.string().max(200),
});
export const tripWeatherSuggestions = z.object({ tripId });

const weatherDecisionState = z.object({
  semanticId,
  ruleSignature: z.string().max(200),
});
const weatherApplyItem = z.object({
  semanticId,
  name,
  category: z.enum(ITEM_CATEGORIES),
  qty,
  optional: z.boolean(),
  groupId: z.literal(TOILETRY_GROUP).optional(),
});
const weatherClothingLine = z.object({
  id: semanticId,
  semanticId: semanticId.optional(),
  name,
  category: z.enum(ITEM_CATEGORIES),
  qty,
  optional: z.boolean().optional(),
  groupId: z.literal(TOILETRY_GROUP).optional(),
});
export const weatherAcceptedChange = z.discriminatedUnion("kind", [
  weatherDecisionState.extend({ kind: z.literal("add"), item: weatherApplyItem }),
  weatherDecisionState.extend({ kind: z.literal("remove") }),
  weatherDecisionState.extend({
    kind: z.literal("split"),
    clothing: z.array(weatherClothingLine).min(1).max(4),
  }),
]);

/** Review decisions contain rule signatures and item definitions, never raw weather. */
export const weatherReviewInput = z.object({
  tripId,
  accepted: z.array(weatherAcceptedChange).max(20),
  skipped: z.array(weatherDecisionState).max(20),
});

/** One atomic Shape-the-list save: create/copy the trip and persist the displayed weather rows together. */
export const createTripWithWeatherInput = z
  .object({
    mode: z.enum(["create", "copy"]),
    sourceId: tripId.nullable(),
    ...routeFields,
    config: tripConfig,
    theme,
    accepted: z.array(weatherAcceptedChange).max(20),
  })
  .superRefine((value, ctx) => {
    oneRouteForm(value, ctx);
    if (value.mode === "copy" && !value.sourceId) {
      ctx.addIssue({ code: "custom", path: ["sourceId"], message: "Required" });
    }
    if (value.mode === "create" && value.sourceId) {
      ctx.addIssue({ code: "custom", path: ["sourceId"], message: "Not allowed" });
    }
  });
