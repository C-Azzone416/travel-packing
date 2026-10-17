// Data-layer entry points. Each one: authorizes the owner from the session, validates its input, loads the
// owner's data, applies the pure domain logic, persists transactionally, and returns a typed Result.
// The owner id never comes from the caller.

import type { ZodType } from "zod";
import { calculateSuggestions, normalizeTripDates } from "../../domain/calc";
import {
  acceptWeather,
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
import {
  beginDraft,
  emptyLifecycleState,
  saveDraft,
  selectDraftLocation,
  startCopyDraft,
  startDraft,
  type LifecycleTrip,
  type SampleLocation,
} from "../../domain/trip-lifecycle";
import { and, eq, isNull } from "drizzle-orm";
import { restoreDeletedTrip, softDeleteTrip } from "../db/retention";
import * as schema from "../db/schema";
import { todayOf, type DataContext } from "./context";
import { fail, type Result } from "./result";
import { run, refuse, type OwnerScope } from "./run";
import * as inputs from "./schemas";
import { ensureDefaultStaples, listStaples, saveStaples } from "./staple-store";
import { insertTrip, loadTrip, loadTrips, lockTrip, saveTrip, type StoredTrip } from "./trip-store";

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

export function updateTripPreferences(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.updatePreferencesInput, input, (trip, { config }) => ({
    trip: recalculateSuggestions(trip, config, calculateSuggestions),
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
  return run(context, inputs.stapleInput, input, async (scope, request) => {
    await ensureDefaultStaples(scope.db, scope.ownerId);
    const current = await listStaples(scope.db, scope.ownerId);
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
      scope.db,
      scope.ownerId,
      exists
        ? current.map((entry) => (entry.id === staple.id ? staple : entry))
        : [...current, staple],
    );
    return listStaples(scope.db, scope.ownerId);
  });
}

// ---------------------------------------------------------------- trip lifecycle

/** Lifecycle domain trips carry a SampleLocation; storage keeps its id and label next to the destination. */
function toStoredTrip(trip: LifecycleTrip): StoredTrip {
  const { location, ...rest } = trip;
  return {
    ...rest,
    locationId: location?.id ?? null,
    locationLabel: location?.label ?? null,
    deletedAt: null,
  };
}

/** Normalized, valid dates or a typed INVALID_INPUT (a return before departure becomes departure). */
function validDates(start: string, end: string): { start: string; end: string } {
  const dates = normalizeTripDates(start, end);
  if (!dates.valid) refuse(fail("INVALID_INPUT", { fields: ["start", "end"] }));
  return { start: dates.start, end: dates.end };
}

/** Save a draft through the domain (location confirmed, dates valid, fresh snapshot) and persist it. */
async function saveNewTrip(
  scope: OwnerScope,
  context: DataContext,
  draft: ReturnType<typeof startDraft>,
  location: SampleLocation,
): Promise<StoredTrip> {
  await ensureDefaultStaples(scope.db, scope.ownerId);
  const staples = await listStaples(scope.db, scope.ownerId);
  const saved = saveDraft(
    beginDraft(emptyLifecycleState(), selectDraftLocation(draft, location)),
    staples,
    { newId: () => crypto.randomUUID(), today: todayOf(context) },
  );
  if (!saved.ok) refuse(fail("INVALID_INPUT", { fields: ["location", "start", "end"] }));
  const trip = toStoredTrip(saved.trip);
  await insertTrip(scope.db, scope.ownerId, trip);
  return (await loadTrip(scope.db, scope.ownerId, trip.id)) ?? refuse(fail("INTERNAL"));
}

/** Create a trip from a confirmed sample location, dates, and preferences. */
export function createTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.createTripInput, input, (scope, request) => {
    const dates = validDates(request.start, request.end);
    return saveNewTrip(
      scope,
      context,
      startDraft(request.config, dates.start, dates.end),
      request.location,
    );
  });
}

/**
 * Copy one of the owner's live trips: preferences only; a new location and dates; every check, bag placement,
 * and Ready state starts clear; `copied_from` records the source. The source is looked up by owner, so another
 * owner's trip is NOT_FOUND and can never be referenced.
 */
export function copyTrip(context: DataContext, input: unknown): Promise<Result<StoredTrip>> {
  return run(context, inputs.copyTripInput, input, async (scope, request) => {
    const source = await mustLoad(scope, request.sourceId);
    const dates = validDates(request.start, request.end);
    const lifecycleSource: LifecycleTrip = { ...source, location: null };
    return saveNewTrip(
      scope,
      context,
      startCopyDraft(lifecycleSource, dates.start, dates.end),
      request.location,
    );
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
