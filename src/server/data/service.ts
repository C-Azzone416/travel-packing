// Data-layer entry points. Each one: authorizes the owner from the session, validates its input, loads the
// owner's data, applies the pure domain logic, persists transactionally, and returns a typed Result.
// The owner id never comes from the caller.

import type { ZodType } from "zod";
import { calculateSuggestions } from "../../domain/calc";
import {
  acceptWeather,
  addToiletryItem,
  editItem,
  recalculateSuggestions,
  removeTripItem,
  reviewWeatherAgain,
  skipWeather,
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
import type { DataContext } from "./context";
import { fail, type Result } from "./result";
import { run, refuse, type OwnerScope } from "./run";
import * as inputs from "./schemas";
import { ensureDefaultStaples, listStaples, saveStaples } from "./staple-store";
import { loadTrip, loadTrips, saveTrip, type StoredTrip } from "./trip-store";

export interface TripResult {
  trip: StoredTrip;
  signals?: Signals;
}

/** Turn a domain rejection into a typed REJECTED error; return the new trip and signals otherwise. */
function unwrap<T>(result: CommandResult<T>): { trip: T; signals: Signals } {
  if (!result.ok) refuse(fail("REJECTED", { reason: result.reason }));
  return { trip: result.trip, signals: result.signals };
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
      const current = await mustLoad(txScope, input.tripId);
      const staples = await listStaples(txScope.db, txScope.ownerId);
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
  return mutateTrip(context, inputs.editItemInput, input, (trip, { itemId, ...edit }, staples) => {
    const result = editItem(trip, staples, itemId, edit);
    if (!result.ok)
      refuse(
        fail(result.reason === "ITEM_NOT_FOUND" ? "NOT_FOUND" : "REJECTED", {
          reason: result.reason,
        }),
      );
    return { trip: result.trip, staples: result.staples };
  });
}

export function removeItemFromTrip(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.removeItemInput, input, (trip, { itemId, scope }, staples) => {
    const result = removeTripItem(trip, staples, itemId, scope);
    if (!result.ok)
      refuse(
        fail(result.reason === "ITEM_NOT_FOUND" ? "NOT_FOUND" : "REJECTED", {
          reason: result.reason,
        }),
      );
    return { trip: result.trip, staples: result.staples };
  });
}

export function addToiletryItemToTrip(context: DataContext, input: unknown) {
  return mutateTrip(context, inputs.addToiletryItemInput, input, (trip, request, staples) => {
    const result = addToiletryItem(trip, staples, {
      id: `toiletry-${crypto.randomUUID()}`,
      name: request.name,
      qty: request.qty,
      packLast: request.packLast,
      scope: request.scope,
    });
    if (!result.ok) refuse(fail("REJECTED", { reason: result.reason }));
    return { trip: result.trip, staples: result.staples };
  });
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
