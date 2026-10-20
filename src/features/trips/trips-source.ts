// The UI talks to trips only through this port, so the real data layer (#10) can replace the in-memory
// source without touching any screen. Per-trip commands mirror the data layer's entry points one for one
// (togglePackedItem, editTripItem, ...), and each returns the changed trip plus the domain's signals.

import { calculateSuggestions, DEFAULT_STAPLES, packingDays, tripDays } from "@/domain/calc";
import {
  acceptWeather,
  addToiletryItem,
  editItem,
  recalculateSuggestions,
  removeTripItem,
  reviewWeatherAgain,
  skipWeather,
  type ItemEdit,
  type ItemOpResult,
  type ToiletryItemInput,
} from "@/domain/item-ops";
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
} from "@/domain/readiness";
import { isThemeId, type ThemeId } from "@/domain/themes";
import type { Scope, Staple, TripConfig } from "@/domain/trip";
import {
  archiveTrip,
  removeTrip,
  restoreTrip,
  saveDraft,
  undoRemoveTrip,
  type LifecycleResult,
  type LifecycleState,
  type LifecycleTrip,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import { routeLabel, tripDatesFromStops, validateStops, type TripStop } from "@/domain/trip-stops";
import { localToday } from "@/lib/today";

/** A changed trip, with what the UI may offer next ("Put bag in suitcase", "Review your bag"). */
export interface TripChange {
  trip: LifecycleTrip;
  signals: Signals;
}

export type NewToiletryItem = Omit<ToiletryItemInput, "id">;

export interface TripsSource {
  load(): Promise<LifecycleState>;
  archive(tripId: string): Promise<LifecycleState>;
  restore(tripId: string): Promise<LifecycleState>;
  remove(tripId: string): Promise<LifecycleState>;
  undoRemove(tripId: string): Promise<LifecycleState>;
  /** Persist a finished draft as a new trip. Rejects (and changes nothing) if the draft is incomplete. */
  createTrip(draft: TripDraft): Promise<LifecycleTrip>;

  /** One live trip. Rejects with NOT_FOUND for an id that is not there. */
  getTrip(tripId: string): Promise<LifecycleTrip>;
  /** The owner's staples (what "Remember for future trips" changes). */
  listStaples(): Promise<Staple[]>;
  /** Create or update one of the owner's staples (matched by id). Applies to future trips only; returns the whole list. */
  upsertStaple(staple: Staple): Promise<Staple[]>;
  /** Sets one item's packed count (clamped to 0..qty). The screen sends one of these per item after taps settle. */
  setPacked(tripId: string, itemId: string, packed: number): Promise<TripChange>;
  togglePacked(tripId: string, itemId: string): Promise<TripChange>;
  incrementPacked(tripId: string, itemId: string): Promise<TripChange>;
  decrementPacked(tripId: string, itemId: string): Promise<TripChange>;
  editItem(tripId: string, itemId: string, edit: ItemEdit): Promise<TripChange>;
  removeItem(tripId: string, itemId: string, scope: Scope): Promise<TripChange>;
  addToiletryItem(tripId: string, input: NewToiletryItem): Promise<TripChange>;
  confirmBagPlacement(tripId: string): Promise<TripChange>;
  undoBagPlacement(tripId: string): Promise<TripChange>;
  markReady(tripId: string): Promise<TripChange>;
  markNotReady(tripId: string): Promise<TripChange>;
  acceptWeather(tripId: string): Promise<TripChange>;
  skipWeather(tripId: string): Promise<TripChange>;
  reviewWeatherAgain(tripId: string): Promise<TripChange>;
  updatePreferences(tripId: string, config: TripConfig): Promise<TripChange>;
  /** Change the trip's picture (#48). Only the six built-in themes are accepted; nothing else about the trip changes. */
  setTheme(tripId: string, theme: ThemeId): Promise<TripChange>;
  /** Replace the trip's route (1-6 stops). Dates, day counts and calculated items follow; rejects an invalid route. */
  setStops(tripId: string, stops: TripStop[]): Promise<TripChange>;
}

export class TripsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripsSourceError";
  }
}

export interface MemorySourceOptions {
  /** Stamps `deletedAt`; injected so the source never reads the clock itself. */
  now: () => number;
  newId?: () => string;
  today?: () => string;
  staples?: readonly Staple[];
}

const NO_SIGNALS: Signals = { promptBagPlacement: false, reviewPrompt: false };

// Applies the domain commands to an in-memory state. Used until #10 lands, and by tests.
export function createMemoryTripsSource(
  initial: LifecycleState,
  {
    now,
    newId = () => crypto.randomUUID(),
    today = localToday,
    staples = DEFAULT_STAPLES,
  }: MemorySourceOptions,
): TripsSource & { snapshot(): LifecycleState; staplesSnapshot(): Staple[] } {
  let state = initial;
  // The owner's staples: "remember for future trips" edits change these, never an existing trip.
  let currentStaples: Staple[] = [...staples];

  const apply = async (result: LifecycleResult): Promise<LifecycleState> => {
    if (!result.ok) throw new TripsSourceError(result.reason);
    state = result.state;
    return state;
  };

  const find = (tripId: string): LifecycleTrip => {
    const trip = state.trips.find((entry) => entry.id === tripId);
    if (!trip) throw new TripsSourceError("NOT_FOUND");
    return trip;
  };

  const store = (trip: LifecycleTrip): void => {
    state = { ...state, trips: state.trips.map((entry) => (entry.id === trip.id ? trip : entry)) };
  };

  // Run a readiness command on one trip: a refusal throws its reason and changes nothing.
  const command = async (
    tripId: string,
    run: (trip: LifecycleTrip) => CommandResult<LifecycleTrip>,
  ): Promise<TripChange> => {
    const result = run(find(tripId));
    if (!result.ok) throw new TripsSourceError(result.reason);
    store(result.trip);
    return { trip: result.trip, signals: result.signals };
  };

  // Run an item operation: it may also change the owner's staples ("remember for future trips").
  const itemOp = async (
    tripId: string,
    run: (trip: LifecycleTrip, staples: Staple[]) => ItemOpResult<LifecycleTrip>,
  ): Promise<TripChange> => {
    const result = run(find(tripId), currentStaples);
    if (!result.ok) throw new TripsSourceError(result.reason);
    store(result.trip);
    currentStaples = result.staples;
    return { trip: result.trip, signals: NO_SIGNALS };
  };

  // Commands the domain applies directly (no result wrapper).
  const direct = async (
    tripId: string,
    run: (trip: LifecycleTrip) => LifecycleTrip,
  ): Promise<TripChange> => {
    const trip = run(find(tripId));
    store(trip);
    return { trip, signals: NO_SIGNALS };
  };

  return {
    snapshot: () => state,
    staplesSnapshot: () => currentStaples,
    load: async () => state,
    archive: (id) => apply(archiveTrip(state, id)),
    restore: (id) => apply(restoreTrip(state, id)),
    remove: (id) => apply(removeTrip(state, id, now())),
    createTrip: async (draft) => {
      const result = saveDraft({ ...state, draft }, [...currentStaples], { newId, today: today() });
      if (!result.ok) throw new TripsSourceError(result.reason);
      state = { ...result.state, draft: null };
      return result.trip;
    },
    undoRemove: async (id) => {
      state = undoRemoveTrip(state, id);
      return state;
    },

    getTrip: async (id) => find(id),
    listStaples: async () => currentStaples,
    upsertStaple: async (staple) => {
      const exists = currentStaples.some((entry) => entry.id === staple.id);
      currentStaples = exists
        ? currentStaples.map((entry) => (entry.id === staple.id ? { ...staple } : entry))
        : [...currentStaples, { ...staple }];
      return currentStaples;
    },
    setPacked: (id, itemId, packed) => command(id, (trip) => setPacked(trip, itemId, packed)),
    togglePacked: (id, itemId) => command(id, (trip) => togglePacked(trip, itemId)),
    incrementPacked: (id, itemId) => command(id, (trip) => incrementPacked(trip, itemId)),
    decrementPacked: (id, itemId) => command(id, (trip) => decrementPacked(trip, itemId)),
    editItem: (id, itemId, edit) =>
      itemOp(id, (trip, owned) => editItem(trip, owned, itemId, edit)),
    removeItem: (id, itemId, scope) =>
      itemOp(id, (trip, owned) => removeTripItem(trip, owned, itemId, scope)),
    addToiletryItem: (id, input) =>
      itemOp(id, (trip, owned) => addToiletryItem(trip, owned, { ...input, id: newId() })),
    confirmBagPlacement: (id) => command(id, confirmBagPlacement),
    undoBagPlacement: (id) => command(id, undoBagPlacement),
    markReady: (id) => command(id, markReady),
    markNotReady: (id) => command(id, markNotReady),
    acceptWeather: (id) => direct(id, acceptWeather),
    skipWeather: (id) => direct(id, skipWeather),
    reviewWeatherAgain: (id) => direct(id, reviewWeatherAgain),
    updatePreferences: (id, config) =>
      direct(id, (trip) => recalculateSuggestions(trip, config, calculateSuggestions)),
    setStops: (id, stops) =>
      direct(id, (trip) => {
        if (!validateStops(stops).ok) throw new TripsSourceError("INVALID_INPUT");
        const { start, end } = tripDatesFromStops(stops);
        const moved = recalculateSuggestions(
          { ...trip, stops, start, end },
          trip.config,
          calculateSuggestions,
        );
        return {
          ...moved,
          days: tripDays(start, end),
          dailyDays: packingDays(start, end),
          // A title the person edited is theirs; one that is still the old route follows the new route.
          destination:
            trip.destination === routeLabel(trip.stops) ? routeLabel(stops) : trip.destination,
          location: stops[0].location,
        };
      }),
    setTheme: (id, theme) => {
      if (!isThemeId(theme)) return Promise.reject(new TripsSourceError("INVALID_INPUT"));
      return direct(id, (trip) => ({ ...trip, theme }));
    },
  };
}
