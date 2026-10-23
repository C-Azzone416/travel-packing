// The UI talks to trips only through this port, so the real data layer (#10) can replace the in-memory
// source without touching any screen. Per-trip commands mirror the data layer's entry points one for one
// (togglePackedItem, editTripItem, ...), and each returns the changed trip plus the domain's signals.

import { calculateSuggestions, SYNTHETIC_STAPLES, tripDays } from "@/domain/calc";
import {
  acceptWeather,
  addCustomItem,
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
import { categoryCounts, listNameTaken, tripItemsFromList } from "@/domain/saved-lists";
import { automaticStamps, normaliseStampLabel } from "@/domain/stamps";
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
import type { SavedListDetail, SavedListSummary } from "@/server/data/service";
import type { WeatherSettings, WeatherSuggestionState } from "@/server/data/weather-store";
import type { AcceptedWeatherDecision, SkippedWeatherDecision } from "./trip-actions";
import type { WeatherFetchResult } from "./weather-client";

/** A changed trip, with what the UI may offer next ("Put bag in suitcase", "Review your bag"). */
export interface TripChange {
  trip: LifecycleTrip;
  signals: Signals;
}

export type NewToiletryItem = Omit<ToiletryItemInput, "id">;

/** A custom item of any addable category (#147). */
export interface NewCustomItem {
  name: string;
  category: string;
  neededQty: number;
}

/** The owner's saved lists, for the create flow's "Start from a saved list" step (#170). Absent on sources without them. */
export interface SavedListsCapability {
  /** Newest change first. */
  list(): Promise<SavedListSummary[]>;
  /** One list with its items; rejects NOT_FOUND for an id that is not the owner's. */
  get(listId: string): Promise<SavedListDetail>;
}

/** What saving a trip as a list gives back: enough to say "“Beach week” saved (24 items)" and link to it. */
export interface SavedListCreated {
  id: string;
  name: string;
  itemCount: number;
}

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
  /**
   * Add a custom item of any addable category (#147). Rejects with message EXISTS when the trip already has it
   * (same normalised name and category; nothing is added), or INVALID_INPUT / NOT_FOUND / the error code.
   */
  addItem(tripId: string, input: NewCustomItem): Promise<TripChange>;
  /**
   * Save the chosen items of a trip as a new saved list (#169): a snapshot of name, category and needed quantity. Rejects
   * with message NAME_TAKEN when the owner already has a list with that name (normalised), or the error code.
   */
  saveAsList(tripId: string, name: string, itemIds: string[]): Promise<SavedListCreated>;
  confirmBagPlacement(tripId: string): Promise<TripChange>;
  undoBagPlacement(tripId: string): Promise<TripChange>;
  markReady(tripId: string): Promise<TripChange>;
  markNotReady(tripId: string): Promise<TripChange>;
  acceptWeather(tripId: string): Promise<TripChange>;
  skipWeather(tripId: string): Promise<TripChange>;
  reviewWeatherAgain(tripId: string): Promise<TripChange>;
  /**
   * Apply new planning preferences and recalculate (the merge rules keep manual items, edits, packed counts and suppressed
   * suggestions). `basedOn` is the trip's `updatedAt` the person reviewed; if it changed since, this rejects with STALE.
   */
  updatePreferences(tripId: string, config: TripConfig, basedOn?: string): Promise<TripChange>;
  /** Change the trip's picture (#48). Only the six built-in themes are accepted; nothing else about the trip changes. */
  setTheme(tripId: string, theme: ThemeId): Promise<TripChange>;
  /**
   * Set or clear the route stamps' labels (#151): the typed text per slot (trimmed, upper-cased, exactly 3 of A-Z and 0-9),
   * or null / blank / the automatic label for no override. Rejects anything else, and a label for a second stamp the route
   * does not have.
   */
  setStampLabels(tripId: string, slot1: string | null, slot2: string | null): Promise<TripChange>;
  /** Replace the trip's route (1-6 stops). Dates, day counts and calculated items follow; rejects an invalid route. */
  setStops(tripId: string, stops: TripStop[]): Promise<TripChange>;
  savedLists?: SavedListsCapability;
  /** Live weather integration exists on the real source. Memory/unit sources may leave it out. */
  weather?: {
    getSettings(): Promise<WeatherSettings>;
    updateSettings(change: Partial<WeatherSettings>): Promise<WeatherSettings>;
    getTripWeather(tripId: string): Promise<WeatherFetchResult>;
    previewDraft(stops: TripStop[]): Promise<WeatherFetchResult>;
    createTripWithReview(
      draft: TripDraft,
      accepted: AcceptedWeatherDecision[],
    ): Promise<LifecycleTrip>;
    listSuggestions(tripId: string): Promise<WeatherSuggestionState[]>;
    applyReview(
      tripId: string,
      accepted: AcceptedWeatherDecision[],
      skipped: SkippedWeatherDecision[],
    ): Promise<TripChange>;
  };
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
  /** The owner's saved lists (#170). Left out, the source has none and the create flow shows no list step. */
  savedLists?: readonly SavedListDetail[];
}

const summaryOf = (
  id: string,
  name: string,
  updatedAt: string,
  items: SavedListDetail["items"],
): SavedListSummary => ({
  id,
  name,
  updatedAt,
  itemCount: items.length,
  categories: categoryCounts(items),
});

const NO_SIGNALS: Signals = { promptBagPlacement: false, reviewPrompt: false };

// Applies the domain commands to an in-memory state. Used until #10 lands, and by tests.
export function createMemoryTripsSource(
  initial: LifecycleState,
  {
    now,
    newId = () => crypto.randomUUID(),
    today = localToday,
    staples = SYNTHETIC_STAPLES,
    savedLists,
  }: MemorySourceOptions,
): TripsSource & { snapshot(): LifecycleState; staplesSnapshot(): Staple[] } {
  let state = initial;
  // The owner's staples: "remember for future trips" edits change these, never an existing trip.
  let currentStaples: Staple[] = [...staples];
  // The names of the saved lists made from trips (#169); the in-memory source keeps no more of them than that.
  let madeLists: { id: string; name: string }[] = [];

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

  const lists = savedLists
    ? {
        list: async () =>
          savedLists.map(({ id, name, updatedAt, items }) => summaryOf(id, name, updatedAt, items)),
        get: async (listId: string) => {
          const found = savedLists.find((entry) => entry.id === listId);
          if (!found) throw new TripsSourceError("NOT_FOUND");
          return found;
        },
      }
    : undefined;

  return {
    snapshot: () => state,
    staplesSnapshot: () => currentStaples,
    ...(lists ? { savedLists: lists } : {}),
    load: async () => state,
    archive: (id) => apply(archiveTrip(state, id)),
    restore: (id) => apply(restoreTrip(state, id)),
    remove: (id) => apply(removeTrip(state, id, now())),
    createTrip: async (draft) => {
      const list = draft.savedListId
        ? (savedLists ?? []).find((entry) => entry.id === draft.savedListId)
        : null;
      if (draft.savedListId && !list) throw new TripsSourceError("NOT_FOUND");
      if (list && list.items.length === 0) throw new TripsSourceError("INVALID_INPUT");
      const result = saveDraft(
        { ...state, draft },
        [...currentStaples],
        { newId, today: today() },
        list ? tripItemsFromList(list) : undefined,
      );
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
    addItem: (id, input) =>
      direct(id, (trip) => {
        const added = addCustomItem(trip, {
          id: newId(),
          name: input.name,
          category: input.category,
          neededQty: input.neededQty,
        });
        if (!added.ok) {
          throw new TripsSourceError(added.reason === "EXISTS" ? "EXISTS" : "INVALID_INPUT");
        }
        return added.trip;
      }),
    saveAsList: async (id, name, itemIds) => {
      const trip = find(id);
      if (listNameTaken(madeLists, name)) throw new TripsSourceError("NAME_TAKEN");
      const wanted = new Set(itemIds);
      const items = trip.items.filter((item) => wanted.has(item.id));
      if (items.length === 0 || items.length !== wanted.size) {
        throw new TripsSourceError("INVALID_INPUT");
      }
      const list = { id: newId(), name: name.trim() };
      madeLists = [...madeLists, list];
      return { ...list, itemCount: items.length };
    },
    confirmBagPlacement: (id) => command(id, confirmBagPlacement),
    undoBagPlacement: (id) => command(id, undoBagPlacement),
    markReady: (id) => command(id, markReady),
    markNotReady: (id) => command(id, markNotReady),
    acceptWeather: (id) => direct(id, acceptWeather),
    skipWeather: (id) => direct(id, skipWeather),
    reviewWeatherAgain: (id) => direct(id, reviewWeatherAgain),
    updatePreferences: (id, config, basedOn) =>
      direct(id, (trip) => {
        // A trip that carries a save time (the server's) must still be the one the person reviewed.
        if (basedOn !== undefined && trip.updatedAt !== undefined && basedOn !== trip.updatedAt)
          throw new TripsSourceError("STALE");
        return recalculateSuggestions(trip, config, calculateSuggestions);
      }),
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
          // A title the person edited is theirs; one that is still the old route follows the new route.
          destination:
            trip.destination === routeLabel(trip.stops) ? routeLabel(stops) : trip.destination,
          location: stops[0].location,
          // The owner's text survives a route edit, except slot 2 once the route has no second stamp (#151).
          stampLabels: [
            trip.stampLabels?.[0] ?? null,
            automaticStamps(stops).length < 2 ? null : (trip.stampLabels?.[1] ?? null),
          ],
        };
      }),
    setTheme: (id, theme) => {
      if (!isThemeId(theme)) return Promise.reject(new TripsSourceError("INVALID_INPUT"));
      return direct(id, (trip) => ({ ...trip, theme }));
    },
    setStampLabels: (id, slot1, slot2) =>
      direct(id, (trip) => {
        const automatic = automaticStamps(trip.stops);
        const stored = [slot1, slot2].map((raw, index) => {
          if (raw === null) return null;
          const label = normaliseStampLabel(raw);
          if (!label.ok || (index === 1 && label.label !== null && automatic.length < 2)) {
            throw new TripsSourceError("INVALID_INPUT");
          }
          return label.label === automatic[index]?.label ? null : label.label;
        });
        return { ...trip, stampLabels: [stored[0], stored[1]] };
      }),
  };
}
