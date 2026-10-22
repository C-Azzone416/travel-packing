// Data-layer entry points. Each one: authorizes the owner from the session, validates its input, loads the
// owner's data, applies the pure domain logic, persists transactionally, and returns a typed Result.
// The owner id never comes from the caller.

import type { ZodType } from "zod";
import { calculateSuggestions, normalizeTripDates, packingDays, tripDays } from "../../domain/calc";
import {
  acceptWeather,
  addCustomItem,
  addToiletryItem,
  editItem,
  recalculateSuggestions,
  removeTripItem,
  reviewWeatherAgain,
  skipWeather,
  type ItemOpResult,
} from "../../domain/item-ops";
import {
  confirmBagPlacement,
  decrementPacked,
  incrementPacked,
  markNotReady,
  markReady,
  setPacked,
  togglePacked,
  undoBagPlacement,
  type CommandResult,
  type Signals,
} from "../../domain/readiness";
import type { Staple } from "../../domain/trip";
import { applyWeatherChanges } from "../../domain/weather/apply";
import {
  beginDraft,
  emptyLifecycleState,
  saveDraft,
  selectDraftLocation,
  setDraftConfig,
  setDraftSavedList,
  setDraftStops,
  setDraftTheme,
  startCopyDraft,
  startDraft,
  type LifecycleTrip,
  type SampleLocation,
  type TripDraft,
} from "../../domain/trip-lifecycle";
import {
  routeLabel,
  tripDatesFromStops,
  validateStops,
  type TripStop,
} from "../../domain/trip-stops";
import { and, eq, isNull } from "drizzle-orm";
import { restoreDeletedTrip, softDeleteTrip } from "../db/retention";
import * as schema from "../db/schema";
import { todayOf, type DataContext } from "./context";
import { fail, type Result } from "./result";
import { run, refuse, type OwnerScope } from "./run";
import * as inputs from "./schemas";
import { ensureDefaultStaples, listStaples, saveStaples } from "./staple-store";
import { curatedResolver } from "../locations/resolver";
import { round2 } from "../locations/open-meteo";
import type { Appearance } from "../../domain/appearance";
import { readAppearance, writeAppearance } from "./appearance-store";
import {
  categoryCounts,
  findListItemDuplicate,
  listNameTaken,
  tripItemsFromList,
  type CategoryCount,
  type SavedListItem,
} from "../../domain/saved-lists";
import {
  deleteSavedList,
  getSavedList,
  listSavedListMetas,
  listSavedLists,
  updateSavedList,
} from "./saved-list-store";
import {
  insertTrip,
  loadTrip,
  loadTrips,
  lockTrip,
  saveTrip,
  type StoredPlace,
  type StoredTrip,
} from "./trip-store";
import {
  listWeatherSuggestions,
  readWeatherSettings,
  writeWeatherSettings,
  writeWeatherSuggestion,
  type WeatherSettings,
  type WeatherSuggestionState,
} from "./weather-store";

export interface TripResult {
  trip: StoredTrip;
  signals?: Signals;
}

/** Turn a domain rejection into a typed REJECTED error; return the new trip and signals otherwise. */
function unwrap<T>(result: CommandResult<T>): { trip: T; signals: Signals } {
  if (!result.ok) refuse(fail("REJECTED", { reason: result.reason }));
  return { trip: result.trip, signals: result.signals };
}

/** Turn a domain item-operation result into a mutation, or a typed NOT_FOUND / REJECTED error. */
function unwrapItemOp<T>(result: ItemOpResult<T>): { trip: T; staples: Staple[] } {
  if (!result.ok) {
    refuse(
      fail(result.reason === "ITEM_NOT_FOUND" ? "NOT_FOUND" : "REJECTED", {
        reason: result.reason,
      }),
    );
  }
  return { trip: result.trip, staples: result.staples };
}

async function mustLoad(scope: OwnerScope, tripId: string): Promise<StoredTrip> {
  const trip = await loadTrip(scope.db, scope.ownerId, tripId);
  if (!trip) refuse(fail("NOT_FOUND"));
  return trip;
}

interface Mutation {
  trip: StoredTrip;
  staples?: Staple[];
  signals?: Signals;
}

/**
 * Load one of the owner's live trips, apply a domain change, and persist trip (+ staples) atomically.
 * Another owner's trip id is indistinguishable from a missing one: NOT_FOUND.
 */
function mutateTrip<Input extends { tripId: string }>(
  context: DataContext,
  schema: ZodType<Input>,
  raw: unknown,
  apply: (trip: StoredTrip, input: Input, staples: Staple[]) => Mutation,
): Promise<Result<TripResult>> {
  return run(context, schema, raw, async (scope, input) =>
    scope.db.transaction(async (tx) => {
      const txScope: OwnerScope = { db: tx as OwnerScope["db"], ownerId: scope.ownerId };
      // Serialize edits to this trip (and to the owner's staples): see lockTrip.
      if (!(await lockTrip(txScope.db, txScope.ownerId, input.tripId))) refuse(fail("NOT_FOUND"));
      const current = await mustLoad(txScope, input.tripId);
      const staples = await listStaples(txScope.db, txScope.ownerId, { lock: true });
      const next = apply(current, input, staples);
      if (!(await saveTrip(txScope.db, txScope.ownerId, next.trip))) refuse(fail("NOT_FOUND"));
      if (next.staples && next.staples !== staples) {
        await saveStaples(txScope.db, txScope.ownerId, next.staples);
      }
      return { trip: next.trip, signals: next.signals };
    }),
  );
}

// ---------------------------------------------------------------- reading

export function listTrips(context: DataContext): Promise<Result<StoredTrip[]>> {
  return run(context, inputs.none, {}, (scope) =>
    loadTrips(scope.db, scope.ownerId, { filter: "live" }),
  );
}

export function getTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.tripOnly, input, (scope, { tripId }) => mustLoad(scope, tripId));
}

export function listStaplesForOwner(context: DataContext): Promise<Result<Staple[]>> {
  return run(context, inputs.none, {}, async (scope) => {
    await ensureDefaultStaples(scope.db, scope.ownerId);
    return listStaples(scope.db, scope.ownerId);
  });
}

// ---------------------------------------------------------------- packing progress

const progress =
  (step: (trip: StoredTrip, itemId: string) => CommandResult<StoredTrip>) =>
  (context: DataContext, input: unknown) =>
    mutateTrip(context, inputs.tripItem, input, (trip, { itemId }) => unwrap(step(trip, itemId)));

export const togglePackedItem = progress(togglePacked);
export const incrementPackedItem = progress(incrementPacked);
export const decrementPackedItem = progress(decrementPacked);

export function setPackedItem(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.setPackedInput, input, (trip, { itemId, packed }) =>
    unwrap(setPacked(trip, itemId, packed)),
  );
}

// ---------------------------------------------------------------- toiletry bag and Ready

const tripCommand =
  (step: (trip: StoredTrip) => CommandResult<StoredTrip>) =>
  (context: DataContext, input: unknown) =>
    mutateTrip(context, inputs.tripOnly, input, (trip) => unwrap(step(trip)));

export const confirmToiletryBag = tripCommand(confirmBagPlacement);
export const undoToiletryBag = tripCommand(undoBagPlacement);
export const markTripReady = tripCommand(markReady);
export const markTripNotReady = tripCommand(markNotReady);

// ---------------------------------------------------------------- item operations

export function editTripItem(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.editItemInput, input, (trip, { itemId, ...edit }, staples) =>
    unwrapItemOp(editItem(trip, staples, itemId, edit)),
  );
}

export function removeItemFromTrip(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.removeItemInput, input, (trip, { itemId, scope }, staples) =>
    unwrapItemOp(removeTripItem(trip, staples, itemId, scope)),
  );
}

export function addToiletryItemToTrip(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.addToiletryItemInput, input, (trip, request, staples) =>
    unwrapItemOp(
      addToiletryItem(trip, staples, {
        id: `toiletry-${crypto.randomUUID()}`,
        name: request.name,
        qty: request.qty,
        packLast: request.packLast,
        scope: request.scope,
      }),
    ),
  );
}

/**
 * Add a custom item of any addable category to one of the owner's trips (#147). An item that is already there is
 * REJECTED with reason EXISTS (nothing is saved), a bad category or quantity is INVALID_INPUT with the field names,
 * and another owner's trip id is NOT_FOUND.
 */
export function addItemToTrip(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.addItemInput, input, (trip, request) => {
    const added = addCustomItem(trip, {
      id: `custom-${crypto.randomUUID()}`,
      name: request.name,
      category: request.category,
      neededQty: request.neededQty,
    });
    if (!added.ok) {
      const invalid: Record<string, string> = {
        EMPTY_NAME: "name",
        NAME_TOO_LONG: "name",
        INVALID_CATEGORY: "category",
        INVALID_QTY: "neededQty",
      };
      const field = invalid[added.reason];
      if (field) refuse(fail("INVALID_INPUT", { fields: [field] }));
      refuse(fail("REJECTED", { reason: added.reason }));
    }
    return { trip: added.trip };
  });
}

export function updateTripPreferences(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.updatePreferencesInput, input, (trip, { config }) => ({
    trip: recalculateSuggestions(trip, config, calculateSuggestions),
  }));
}

/** Change a trip's picture (#48). Only the six built-in names are accepted; nothing else about the trip changes. */
export function setTripTheme(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.setThemeInput, input, (trip, { theme }) => ({
    trip: { ...trip, theme },
  }));
}

// ---------------------------------------------------------------- weather (simulated)

const weather =
  (step: (trip: StoredTrip) => StoredTrip) => (context: DataContext, input: unknown) =>
    mutateTrip(context, inputs.tripOnly, input, (trip) => ({ trip: step(trip) }));

export const acceptTripWeather = weather(acceptWeather);
export const skipTripWeather = weather(skipWeather);
export const reviewTripWeatherAgain = weather(reviewWeatherAgain);

// ---------------------------------------------------------------- staples

/** Create or update one of the owner's staples (bumps its version). Trip snapshots are never touched. */
export function upsertStaple(context: DataContext, input: unknown): Promise<Result<Staple[]>> {
  return run(context, inputs.stapleInput, input, (scope, request) =>
    // One transaction, reading the owner's staples WITH a lock: the write below replaces the whole set (anything not in
    // the list is deleted), so two concurrent upserts of different staples must not both start from the same snapshot.
    scope.db.transaction(async (tx) => {
      const db = tx as OwnerScope["db"];
      await ensureDefaultStaples(db, scope.ownerId);
      const current = await listStaples(db, scope.ownerId, { lock: true });
      const staple: Staple = {
        id: request.semanticId,
        name: request.name,
        category: request.category,
        qty: request.qty,
        cadence: request.cadence,
        packLast: request.packLast,
        ...(request.groupId ? { groupId: request.groupId } : {}),
      };
      const exists = current.some((entry) => entry.id === staple.id);
      await saveStaples(
        db,
        scope.ownerId,
        exists
          ? current.map((entry) => (entry.id === staple.id ? staple : entry))
          : [...current, staple],
      );
      return listStaples(db, scope.ownerId);
    }),
  );
}

// ---------------------------------------------------------------- trip lifecycle

/** Lifecycle domain trips carry a SampleLocation; storage keeps its id and label next to the destination. */
function toStoredTrip(trip: LifecycleTrip): StoredTrip {
  const { location, ...rest } = trip;
  return {
    ...rest,
    locationId: location?.id ?? null,
    locationLabel: location?.label ?? null,
    place: location ? toStoredPlace(location) : null,
    deletedAt: null,
  };
}

const orNull = (value: string): string | null => (value === "" ? null : value);

/**
 * The structured place stored next to a trip's destination (#47). Coordinates exist only for a provider place
 * and are rounded here again, so even a resolver that returned more precision could never store it.
 */
function stopPlace(location: SampleLocation): StoredPlace {
  return toStoredPlace(location);
}

function toStoredPlace(location: SampleLocation): StoredPlace {
  const fromProvider = location.provider !== undefined && location.providerPlaceId !== undefined;
  const hasCoordinates =
    fromProvider && location.latitude !== undefined && location.longitude !== undefined;
  return {
    provider: fromProvider ? (location.provider ?? null) : null,
    placeId: fromProvider ? (location.providerPlaceId ?? null) : null,
    region: orNull(location.region),
    country: orNull(location.country),
    countryCode: orNull(location.countryCode),
    latitude: hasCoordinates ? round2(location.latitude as number) : null,
    longitude: hasCoordinates ? round2(location.longitude as number) : null,
    timezone: fromProvider ? (location.timezone ?? null) : null,
  };
}

/**
 * Turn the place id the browser sent into the canonical place, server-side. Only the id is trusted: the city,
 * region, coordinates and timezone that get stored come from the resolver, never from the request. An id nobody
 * recognizes is INVALID_INPUT; a lookup that is down is UNAVAILABLE and nothing is saved.
 */
async function resolveLocation(context: DataContext, id: string): Promise<SampleLocation> {
  let found: SampleLocation | null;
  try {
    found = await (context.resolveLocation ?? curatedResolver)(id);
  } catch {
    refuse(fail("UNAVAILABLE"));
  }
  // Unknown id, or a resolved place outside the stored bounds (checked only; the provider fields are kept).
  if (!found || !inputs.sampleLocation.safeParse(found).success) {
    refuse(fail("INVALID_INPUT", { fields: ["location"] }));
  }
  return found;
}

/** Normalized, valid dates or a typed INVALID_INPUT (a return before departure becomes departure). */
function validDates(start: string, end: string): { start: string; end: string } {
  const dates = normalizeTripDates(start, end);
  if (!dates.valid) refuse(fail("INVALID_INPUT", { fields: ["start", "end"] }));
  return { start: dates.start, end: dates.end };
}

/** Save a draft through the domain (every place confirmed, dates valid, fresh snapshot) and persist it. */
async function saveNewTrip(
  scope: OwnerScope,
  context: DataContext,
  draft: TripDraft,
): Promise<StoredTrip> {
  const trip = await buildNewTrip(scope, context, draft);
  await insertTrip(scope.db, scope.ownerId, trip);
  return (await loadTrip(scope.db, scope.ownerId, trip.id)) ?? refuse(fail("INTERNAL"));
}

/** Build a fresh stored snapshot without inserting it, for atomic compound creates. */
async function buildNewTrip(
  scope: OwnerScope,
  context: DataContext,
  draft: TripDraft,
): Promise<StoredTrip> {
  await ensureDefaultStaples(scope.db, scope.ownerId);
  const staples = await listStaples(scope.db, scope.ownerId);
  // A saved list replaces staples and recommendations (#170). It is looked up by this owner: another owner's list, or
  // one that is gone, is NOT_FOUND exactly like a missing one, and an empty list has nothing to start a trip from.
  const list = draft.savedListId
    ? await getSavedList(scope.db, scope.ownerId, draft.savedListId)
    : null;
  if (list && list.items.length === 0) refuse(fail("INVALID_INPUT", { fields: ["savedListId"] }));
  const saved = saveDraft(
    beginDraft(emptyLifecycleState(), draft),
    staples,
    { newId: () => crypto.randomUUID(), today: todayOf(context) },
    list ? tripItemsFromList(list) : undefined,
  );
  if (!saved.ok) refuse(fail("INVALID_INPUT", { fields: ["location", "start", "end"] }));
  return toStoredTrip(saved.trip);
}

/**
 * The stops the browser named, with each place resolved server-side (the same place id is looked up once) and the
 * route checked. Resolved before any database write, so a slow lookup never holds a transaction open.
 */
async function resolveStops(
  context: DataContext,
  named: readonly { location: { id: string }; arrive: string; leave: string }[],
): Promise<TripStop[]> {
  const places = new Map<string, SampleLocation>();
  for (const { location } of named) {
    if (!places.has(location.id))
      places.set(location.id, await resolveLocation(context, location.id));
  }
  const stops = named.map((stop): TripStop => ({
    location: { ...(places.get(stop.location.id) as SampleLocation) },
    arrive: stop.arrive,
    leave: stop.leave,
  }));
  if (!validateStops(stops).ok) refuse(fail("INVALID_INPUT", { fields: ["stops"] }));
  return stops;
}

/** The single-destination form as a draft: one place, dates normalized as before. */
async function singleStopDraft(
  context: DataContext,
  request: { location?: { id: string }; start?: string; end?: string },
  begin: (start: string, end: string) => TripDraft,
): Promise<TripDraft> {
  const dates = validDates(request.start as string, request.end as string);
  const location = await resolveLocation(context, (request.location as { id: string }).id);
  return selectDraftLocation(begin(dates.start, dates.end), location);
}

/** Create a trip from a confirmed location (or an ordered list of stops), dates, and preferences. */
export function createTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.createTripInput, input, async (scope, request) => {
    const begin = (start: string, end: string) =>
      startDraft(request.config, start, end, request.theme);
    const draft = request.stops
      ? setDraftStops(
          begin(request.stops[0].arrive, request.stops[0].leave),
          await resolveStops(context, request.stops),
        )
      : await singleStopDraft(context, request, begin);
    return saveNewTrip(
      scope,
      context,
      request.savedListId ? setDraftSavedList(draft, request.savedListId) : draft,
    );
  });
}

/**
 * Copy one of the owner's live trips: preferences only; a new location (or stops) and dates; every check, bag
 * placement, and Ready state starts clear; `copied_from` records the source. The source is looked up by owner, so
 * another owner's trip is NOT_FOUND and can never be referenced.
 */
export function copyTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.copyTripInput, input, async (scope, request) => {
    const source = await mustLoad(scope, request.sourceId);
    // The single-destination form chooses its place and dates anew, whatever route the source had.
    const lifecycleSource: LifecycleTrip = { ...source, location: null, stops: [] };
    const begin = (start: string, end: string) => startCopyDraft(lifecycleSource, start, end);
    const draft = request.stops
      ? setDraftStops(
          begin(request.stops[0].arrive, request.stops[0].leave),
          await resolveStops(context, request.stops),
        )
      : await singleStopDraft(context, request, begin);
    return saveNewTrip(scope, context, request.theme ? setDraftTheme(draft, request.theme) : draft);
  });
}

/** Create/copy the trip and apply the Shape-the-list weather rows in one transaction. */
export function createTripWithWeatherReview(
  context: DataContext,
  input: unknown,
): Promise<Result<StoredTrip>> {
  return run(context, inputs.createTripWithWeatherInput, input, async (scope, request) => {
    const copied =
      request.mode === "copy" ? await mustLoad(scope, request.sourceId as string) : null;
    const begin = (start: string, end: string) =>
      copied
        ? startCopyDraft({ ...copied, location: null, stops: [] }, start, end)
        : startDraft(request.config, start, end, request.theme);
    let draft = request.stops
      ? setDraftStops(
          begin(request.stops[0].arrive, request.stops.at(-1)?.leave ?? request.stops[0].leave),
          await resolveStops(context, request.stops),
        )
      : await singleStopDraft(context, request, begin);
    draft = setDraftTheme(setDraftConfig(draft, request.config), request.theme);

    return scope.db.transaction(async (tx) => {
      const txScope: OwnerScope = { db: tx as OwnerScope["db"], ownerId: scope.ownerId };
      const base = await buildNewTrip(txScope, context, draft);
      const trip = applyWeatherChanges(base, request.accepted);
      await insertTrip(txScope.db, txScope.ownerId, trip);
      for (const decision of request.accepted) {
        await writeWeatherSuggestion(txScope.db, txScope.ownerId, trip.id, {
          semanticId: decision.semanticId,
          status: "accepted",
          ruleSignature: decision.ruleSignature,
        });
      }
      return (await loadTrip(txScope.db, txScope.ownerId, trip.id)) ?? refuse(fail("INTERNAL"));
    });
  });
}

/**
 * Replace a saved trip's stops. Trip start and end follow the stops, the day counts are recomputed, and the
 * calculated items are recalculated from the trip's own preferences (as a preference change does). The title
 * (`destination`) is left alone unless it still equals the old route, in which case it follows the new route.
 */
export function setTripStops(context: DataContext, input: unknown) {
  return run(context, inputs.setStopsInput, input, async (scope, request) => {
    const stops = await resolveStops(context, request.stops);
    return scope.db.transaction(async (tx) => {
      const txScope: OwnerScope = { db: tx as OwnerScope["db"], ownerId: scope.ownerId };
      if (!(await lockTrip(txScope.db, txScope.ownerId, request.tripId))) refuse(fail("NOT_FOUND"));
      const current = await mustLoad(txScope, request.tripId);
      const { start, end } = tripDatesFromStops(stops);
      const moved = recalculateSuggestions(
        { ...current, stops, start, end },
        current.config,
        calculateSuggestions,
      );
      const next: StoredTrip = {
        ...moved,
        days: tripDays(start, end),
        dailyDays: packingDays(start, end),
        destination:
          current.destination === routeLabel(current.stops)
            ? routeLabel(stops)
            : current.destination,
        place: stopPlace(stops[0].location),
        locationId: stops[0].location.id,
        locationLabel: stops[0].location.label,
      };
      if (!(await saveTrip(txScope.db, txScope.ownerId, next))) refuse(fail("NOT_FOUND"));
      return mustLoad(txScope, request.tripId);
    });
  });
}

async function setArchived(
  scope: OwnerScope,
  tripId: string,
  archived: boolean,
): Promise<StoredTrip> {
  const updated = await scope.db
    .update(schema.trips)
    .set({ archived, updatedAt: new Date() })
    .where(
      and(
        eq(schema.trips.id, tripId),
        eq(schema.trips.ownerId, scope.ownerId),
        isNull(schema.trips.deletedAt),
      ),
    )
    .returning({ id: schema.trips.id });
  if (updated.length === 0) refuse(fail("NOT_FOUND"));
  return mustLoad(scope, tripId);
}

/** Manual flag, independent of Ready and of the dates. */
export function archiveTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.tripOnly, input, (scope, { tripId }) =>
    setArchived(scope, tripId, true),
  );
}

/** Clear the archive flag (a future trip returns to Upcoming; a past one stays past by date). */
export function restoreArchivedTrip(
  context: DataContext,
  input: unknown,
): Promise<Result<StoredTrip>> {
  return run(context, inputs.tripOnly, input, (scope, { tripId }) =>
    setArchived(scope, tripId, false),
  );
}

/** Recoverable delete: the trip moves to Recently deleted (nothing is purged here; that policy is #28). */
export function removeTrip(
  context: DataContext,
  input: unknown,
): Promise<Result<{ tripId: string }>> {
  return run(context, inputs.tripOnly, input, async (scope, { tripId }) => {
    if (!(await softDeleteTrip(scope.db, scope.ownerId, tripId, context.now())))
      refuse(fail("NOT_FOUND"));
    return { tripId };
  });
}

/** Undo a remove: the exact trip comes back. A trip that is not deleted (or not yours) is NOT_FOUND. */
export function undoRemoveTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.tripOnly, input, async (scope, { tripId }) => {
    if (!(await restoreDeletedTrip(scope.db, scope.ownerId, tripId))) refuse(fail("NOT_FOUND"));
    return mustLoad(scope, tripId);
  });
}

export function listRecentlyDeletedTrips(context: DataContext): Promise<Result<StoredTrip[]>> {
  return run(context, inputs.none, {}, (scope) =>
    loadTrips(scope.db, scope.ownerId, { filter: "deleted" }),
  );
}

// ---------------------------------------------------------------- appearance (colour theme)

export function getAppearance(context: DataContext): Promise<Result<Appearance>> {
  return run(context, inputs.none, {}, (scope) => readAppearance(scope.db, scope.ownerId));
}

/** Save the person's explicit theme choice. Only the four known ids are accepted. */
export function updateAppearance(
  context: DataContext,
  input: unknown,
): Promise<Result<Appearance>> {
  return run(context, inputs.appearanceInput, input, (scope, { appearance }) =>
    writeAppearance(scope.db, scope.ownerId, appearance),
  );
}

// ---------------------------------------------------------------- weather settings and suggestion status

export function getWeatherSettings(context: DataContext): Promise<Result<WeatherSettings>> {
  return run(context, inputs.none, {}, (scope) => readWeatherSettings(scope.db, scope.ownerId));
}

/** Change the weather opt-in and/or the temperature unit. Fields left out keep their value. */
export function updateWeatherSettings(
  context: DataContext,
  input: unknown,
): Promise<Result<WeatherSettings>> {
  return run(context, inputs.weatherSettingsInput, input, (scope, change) =>
    writeWeatherSettings(scope.db, scope.ownerId, change),
  );
}

/** The status of each weather suggestion on one of the owner's trips. */
export function listTripWeatherSuggestions(
  context: DataContext,
  input: unknown,
): Promise<Result<WeatherSuggestionState[]>> {
  return run(context, inputs.tripWeatherSuggestions, input, async (scope, { tripId }) => {
    await mustLoad(scope, tripId);
    return listWeatherSuggestions(scope.db, scope.ownerId, tripId);
  });
}

/** Record one suggestion's status and rule signature on one of the owner's trips (NOT_FOUND for anyone else's). */
export function setTripWeatherSuggestion(
  context: DataContext,
  input: unknown,
): Promise<Result<WeatherSuggestionState[]>> {
  return run(context, inputs.weatherSuggestionInput, input, async (scope, request) => {
    const { tripId, ...state } = request;
    if (!(await writeWeatherSuggestion(scope.db, scope.ownerId, tripId, state))) {
      refuse(fail("NOT_FOUND"));
    }
    return listWeatherSuggestions(scope.db, scope.ownerId, tripId);
  });
}

/**
 * Apply the checked review rows and persist checked/skipped rule signatures in one owner-scoped transaction.
 * The request contains recommendation decisions, never raw weather observations.
 */
export function applyTripWeatherReview(
  context: DataContext,
  input: unknown,
): Promise<Result<TripResult>> {
  return run(context, inputs.weatherReviewInput, input, async (scope, request) =>
    scope.db.transaction(async (tx) => {
      const txScope: OwnerScope = { db: tx as OwnerScope["db"], ownerId: scope.ownerId };
      if (!(await lockTrip(txScope.db, txScope.ownerId, request.tripId))) refuse(fail("NOT_FOUND"));
      const current = await mustLoad(txScope, request.tripId);
      const trip = applyWeatherChanges(current, request.accepted);
      if (trip !== current && !(await saveTrip(txScope.db, txScope.ownerId, trip))) {
        refuse(fail("NOT_FOUND"));
      }
      for (const decision of request.accepted) {
        await writeWeatherSuggestion(txScope.db, txScope.ownerId, request.tripId, {
          semanticId: decision.semanticId,
          status: "accepted",
          ruleSignature: decision.ruleSignature,
        });
      }
      for (const decision of request.skipped) {
        await writeWeatherSuggestion(txScope.db, txScope.ownerId, request.tripId, {
          semanticId: decision.semanticId,
          status: "skipped",
          ruleSignature: decision.ruleSignature,
        });
      }
      return { trip };
    }),
  );
}

// ---------------------------------------------------------------- saved lists management (#167)
// Lists are created from a trip's packing screen (a later mission); here the owner reads, renames, edits and deletes them.
// Every call is owner-scoped: another owner's list is NOT_FOUND, exactly like a missing one. Trips are never touched.

export interface SavedListSummary {
  id: string;
  name: string;
  itemCount: number;
  /** ISO timestamp of the last change. */
  updatedAt: string;
  categories: CategoryCount[];
}

export interface SavedListDetail {
  id: string;
  name: string;
  updatedAt: string;
  items: SavedListItem[];
}

/** The owner's lists, newest change first: name, item count, when it changed and what it holds. */
export function listSavedListSummaries(context: DataContext): Promise<Result<SavedListSummary[]>> {
  return run(context, inputs.none, {}, async (scope) => {
    const [metas, lists] = await Promise.all([
      listSavedListMetas(scope.db, scope.ownerId),
      listSavedLists(scope.db, scope.ownerId),
    ]);
    const byId = new Map(lists.map((list) => [list.id, list]));
    return metas.map((meta) => {
      const items = byId.get(meta.id)?.items ?? [];
      return { ...meta, itemCount: items.length, categories: categoryCounts(items) };
    });
  });
}

async function loadDetail(scope: OwnerScope, listId: string): Promise<SavedListDetail> {
  const metas = await listSavedListMetas(scope.db, scope.ownerId);
  const meta = metas.find((entry) => entry.id === listId);
  if (!meta) refuse(fail("NOT_FOUND"));
  const list = await getSavedList(scope.db, scope.ownerId, listId);
  return { id: list.id, name: list.name, updatedAt: meta.updatedAt, items: list.items };
}

export function getSavedListDetail(
  context: DataContext,
  input: unknown,
): Promise<Result<SavedListDetail>> {
  return run(context, inputs.savedListOnly, input, (scope, { listId }) =>
    loadDetail(scope, listId),
  );
}

/** Rename a list. Names are unique per owner once normalised (case, accents, spaces): REJECTED with NAME_TAKEN. */
export function renameSavedList(
  context: DataContext,
  input: unknown,
): Promise<Result<SavedListDetail>> {
  return run(context, inputs.renameSavedListInput, input, async (scope, { listId, name }) => {
    const detail = await loadDetail(scope, listId);
    const others = await listSavedLists(scope.db, scope.ownerId);
    if (listNameTaken(others, name, listId)) refuse(fail("REJECTED", { reason: "NAME_TAKEN" }));
    await updateSavedList(scope.db, scope.ownerId, listId, { name, items: detail.items });
    return loadDetail(scope, listId);
  });
}

/** Delete a list and its items. Trips made from it keep their own copy. */
export function deleteSavedListById(
  context: DataContext,
  input: unknown,
): Promise<Result<{ id: string }>> {
  return run(context, inputs.savedListOnly, input, async (scope, { listId }) => {
    await deleteSavedList(scope.db, scope.ownerId, listId);
    return { id: listId };
  });
}

/** Replace a list's items (name unchanged) and return the saved detail. */
async function saveItems(
  scope: OwnerScope,
  listId: string,
  items: SavedListItem[],
): Promise<SavedListDetail> {
  const detail = await loadDetail(scope, listId);
  await updateSavedList(scope.db, scope.ownerId, listId, { name: detail.name, items });
  return loadDetail(scope, listId);
}

/** Add an item to a list. An item already there (same normalised name and category) is REJECTED with EXISTS. */
export function addSavedListItem(
  context: DataContext,
  input: unknown,
): Promise<Result<SavedListDetail>> {
  return run(context, inputs.addSavedListItemInput, input, async (scope, request) => {
    const detail = await loadDetail(scope, request.listId);
    if (findListItemDuplicate(detail.items, request.name, request.category)) {
      refuse(fail("REJECTED", { reason: "EXISTS" }));
    }
    const item: SavedListItem = {
      id: `item-${crypto.randomUUID()}`,
      name: request.name,
      category: request.category,
      qty: request.qty,
    };
    return saveItems(scope, request.listId, [...detail.items, item]);
  });
}

/** Change one item's name, category or quantity. EXISTS if it would now match another item; NOT_FOUND for a bad item id. */
export function updateSavedListItem(
  context: DataContext,
  input: unknown,
): Promise<Result<SavedListDetail>> {
  return run(context, inputs.updateSavedListItemInput, input, async (scope, request) => {
    const detail = await loadDetail(scope, request.listId);
    if (!detail.items.some((item) => item.id === request.itemId)) refuse(fail("NOT_FOUND"));
    if (findListItemDuplicate(detail.items, request.name, request.category, request.itemId)) {
      refuse(fail("REJECTED", { reason: "EXISTS" }));
    }
    return saveItems(
      scope,
      request.listId,
      detail.items.map((item) =>
        item.id === request.itemId
          ? { id: item.id, name: request.name, category: request.category, qty: request.qty }
          : item,
      ),
    );
  });
}

export function removeSavedListItem(
  context: DataContext,
  input: unknown,
): Promise<Result<SavedListDetail>> {
  return run(context, inputs.removeSavedListItemInput, input, async (scope, request) => {
    const detail = await loadDetail(scope, request.listId);
    if (!detail.items.some((item) => item.id === request.itemId)) refuse(fail("NOT_FOUND"));
    return saveItems(
      scope,
      request.listId,
      detail.items.filter((item) => item.id !== request.itemId),
    );
  });
}
