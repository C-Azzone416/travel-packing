// The dashboard's TripsSource backed by the server actions (the real data layer). Client-safe: it only holds the
// action functions it is given, so tests can pass fakes.

import type { LifecycleState, LifecycleTrip, TripDraft } from "@/domain/trip-lifecycle";
import type { CreateTripActionResult, TripsActionResult } from "./actions";
import type { ItemEdit } from "@/domain/item-ops";
import type { Scope, Staple, TripConfig } from "@/domain/trip";
import type { StaplesReadResult, TripCommandResult, TripReadResult } from "./trip-actions";
import {
  TripsSourceError,
  type NewToiletryItem,
  type TripChange,
  type TripsSource,
} from "./trips-source";

export interface TripsActions {
  load(): Promise<TripsActionResult>;
  archive(tripId: string): Promise<TripsActionResult>;
  restore(tripId: string): Promise<TripsActionResult>;
  remove(tripId: string): Promise<TripsActionResult>;
  undoRemove(tripId: string): Promise<TripsActionResult>;
  create(draft: TripDraft): Promise<CreateTripActionResult>;
}

/** The trip screen's actions (#16): one per TripsSource per-trip command, plus the two reads. */
export interface TripActions {
  getTrip(tripId: string): Promise<TripReadResult>;
  listStaples(): Promise<StaplesReadResult>;
  upsertStaple(staple: Staple): Promise<StaplesReadResult>;
  setPacked(tripId: string, itemId: string, packed: number): Promise<TripCommandResult>;
  togglePacked(tripId: string, itemId: string): Promise<TripCommandResult>;
  incrementPacked(tripId: string, itemId: string): Promise<TripCommandResult>;
  decrementPacked(tripId: string, itemId: string): Promise<TripCommandResult>;
  editItem(tripId: string, itemId: string, edit: ItemEdit): Promise<TripCommandResult>;
  removeItem(tripId: string, itemId: string, scope: Scope): Promise<TripCommandResult>;
  addToiletryItem(tripId: string, item: NewToiletryItem): Promise<TripCommandResult>;
  confirmBagPlacement(tripId: string): Promise<TripCommandResult>;
  undoBagPlacement(tripId: string): Promise<TripCommandResult>;
  markReady(tripId: string): Promise<TripCommandResult>;
  markNotReady(tripId: string): Promise<TripCommandResult>;
  acceptWeather(tripId: string): Promise<TripCommandResult>;
  skipWeather(tripId: string): Promise<TripCommandResult>;
  reviewWeatherAgain(tripId: string): Promise<TripCommandResult>;
  updatePreferences(tripId: string, config: TripConfig): Promise<TripCommandResult>;
}

/** A failed action becomes a TripsSourceError carrying only the error code (never data). */
async function unwrap(pending: Promise<TripsActionResult>): Promise<LifecycleState> {
  const result = await pending;
  if (!result.ok) throw new TripsSourceError(result.code);
  return result.state;
}

async function unwrapTrip(pending: Promise<CreateTripActionResult>): Promise<LifecycleTrip> {
  const result = await pending;
  if (!result.ok) throw new TripsSourceError(result.code);
  return result.trip;
}

async function unwrapChange(pending: Promise<TripCommandResult>): Promise<TripChange> {
  const result = await pending;
  if (!result.ok) throw new TripsSourceError(result.code);
  return { trip: result.trip, signals: result.signals };
}

async function unwrapRead(pending: Promise<TripReadResult>): Promise<LifecycleTrip> {
  const result = await pending;
  if (!result.ok) throw new TripsSourceError(result.code);
  return result.trip;
}

async function unwrapStaples(pending: Promise<StaplesReadResult>): Promise<Staple[]> {
  const result = await pending;
  if (!result.ok) throw new TripsSourceError(result.code);
  return result.staples;
}

export function createServerTripsSource(actions: TripsActions, trip: TripActions): TripsSource {
  return {
    load: () => unwrap(actions.load()),
    archive: (id) => unwrap(actions.archive(id)),
    restore: (id) => unwrap(actions.restore(id)),
    remove: (id) => unwrap(actions.remove(id)),
    undoRemove: (id) => unwrap(actions.undoRemove(id)),
    createTrip: (draft) => unwrapTrip(actions.create(draft)),

    getTrip: (id) => unwrapRead(trip.getTrip(id)),
    listStaples: () => unwrapStaples(trip.listStaples()),
    upsertStaple: (staple) => unwrapStaples(trip.upsertStaple(staple)),
    setPacked: (id, itemId, packed) => unwrapChange(trip.setPacked(id, itemId, packed)),
    togglePacked: (id, itemId) => unwrapChange(trip.togglePacked(id, itemId)),
    incrementPacked: (id, itemId) => unwrapChange(trip.incrementPacked(id, itemId)),
    decrementPacked: (id, itemId) => unwrapChange(trip.decrementPacked(id, itemId)),
    editItem: (id, itemId, edit) => unwrapChange(trip.editItem(id, itemId, edit)),
    removeItem: (id, itemId, scope) => unwrapChange(trip.removeItem(id, itemId, scope)),
    addToiletryItem: (id, item) => unwrapChange(trip.addToiletryItem(id, item)),
    confirmBagPlacement: (id) => unwrapChange(trip.confirmBagPlacement(id)),
    undoBagPlacement: (id) => unwrapChange(trip.undoBagPlacement(id)),
    markReady: (id) => unwrapChange(trip.markReady(id)),
    markNotReady: (id) => unwrapChange(trip.markNotReady(id)),
    acceptWeather: (id) => unwrapChange(trip.acceptWeather(id)),
    skipWeather: (id) => unwrapChange(trip.skipWeather(id)),
    reviewWeatherAgain: (id) => unwrapChange(trip.reviewWeatherAgain(id)),
    updatePreferences: (id, config) => unwrapChange(trip.updatePreferences(id, config)),
  };
}
