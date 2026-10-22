// Trip lifecycle (plan §12, §3 Trip history): draft, save, copy, archive/restore, classify,
// remove/undo. Ported from reference/prototype/dist/app.js. Pure and immutable; no framework imports.
//
// Date normalization, the forecast label, and the item list come from the calculator module
// (src/domain/calc). Only the id generator and "today" are injected: the domain has no hidden clock.

import { buildTripItems, forecastLabel, normalizeTripDates, parseDate } from "./calc";
import { DEFAULT_THEME, type ThemeId } from "./themes";
import { TOILETRY_GROUP_ID } from "./toiletry-bag";
import type { Staple, Trip, TripConfig, TripItem } from "./trip";
import {
  daysBetween,
  routeLabel,
  shiftStops,
  tripDatesFromStops,
  validateStops,
  type SampleLocation,
  type TripStop,
} from "./trip-stops";

export type { SampleLocation };

export interface LifecycleTrip extends Trip {
  destination: string;
  location: SampleLocation | null;
  copiedFrom: string | null;
  archived: boolean;
  /** The trip's picture (#48). */
  theme: ThemeId;
}

/** A stop being drafted: its place is unconfirmed until the person picks one. */
export interface DraftStop {
  location: SampleLocation | null;
  arrive: string;
  leave: string;
}

export interface TripDraft {
  mode: "create" | "copy";
  sourceId: string | null;
  /**
   * The ordered stops of a multi-stop draft (2 or more). Absent for a single-destination draft, whose one stop is
   * `location` + `start` + `end` below. These three always mirror the route (first stop's place, first arrive, last
   * leave), so single-stop callers keep working; read the route with `draftStops`.
   */
  stops?: DraftStop[];
  /** Only a confirmed location object counts; free text never confirms a destination. */
  location: SampleLocation | null;
  start: string;
  end: string;
  config: TripConfig;
  /** Chosen on step 1; Travel until changed, and a copy starts from the source trip's theme. */
  theme: ThemeId;
  /**
   * The one saved list this new trip starts from (#170), or absent for today's staples plus recommendations. Only a
   * new (not copied) trip can have one. Just the id: the server loads the list itself, owner-scoped.
   */
  savedListId?: string | null;
}

export interface DeletedTrip {
  trip: LifecycleTrip;
  deletedAt: number;
}

/** Saved trips (newest first), the recently-deleted list, and the separate in-progress draft. */
export interface LifecycleState {
  trips: LifecycleTrip[];
  deletedTrips: DeletedTrip[];
  draft: TripDraft | null;
}

export interface TripBuilderDeps {
  newId: () => string;
  /** Explicit "today" (YYYY-MM-DD). The date/timezone policy is pending #26. */
  today: string;
}

export type TripClassification = "upcoming" | "past" | "archived";

export type LifecycleRejection =
  "NO_DRAFT" | "LOCATION_NOT_CONFIRMED" | "INVALID_DATES" | "TRIP_NOT_FOUND";

export type LifecycleResult =
  | { ok: true; state: LifecycleState; trip: LifecycleTrip }
  | { ok: false; reason: LifecycleRejection; state: LifecycleState };

const BATHROOM_NAMES: ReadonlySet<string> = new Set([
  "toothbrush",
  "toothpaste",
  "deodorant",
  "contacts",
]);

export function emptyLifecycleState(): LifecycleState {
  return { trips: [], deletedTrips: [], draft: null };
}

// ---------------------------------------------------------------- drafts

/** The draft's route: its stops when it has several, otherwise the one stop named by location, start and end. */
export function draftStops(draft: TripDraft): DraftStop[] {
  return draft.stops && draft.stops.length > 1
    ? draft.stops
    : [{ location: draft.location, arrive: draft.start, leave: draft.end }];
}

/** The draft with this route; a single stop is stored in the single-destination fields only. */
function withStops(draft: TripDraft, stops: DraftStop[]): TripDraft {
  const { stops: _previous, ...rest } = draft;
  void _previous;
  return {
    ...rest,
    ...(stops.length > 1 ? { stops } : {}),
    location: stops[0].location,
    start: stops[0].arrive,
    end: stops[stops.length - 1].leave,
  };
}

/** Start a new draft. Dates are normalized (a return before departure becomes departure). */
export function startDraft(
  config: TripConfig,
  start: string,
  end: string,
  theme: ThemeId = DEFAULT_THEME,
): TripDraft {
  const dates = normalizeTripDates(start, end);
  return {
    mode: "create",
    sourceId: null,
    location: null,
    start: dates.start,
    end: dates.end,
    config: { ...config },
    theme,
  };
}

/**
 * Start a copy draft: the source's preference config and theme are carried over. A single-stop source asks for a
 * location and dates anew; a multi-stop source keeps its route, every stop shifted by the same offset so the first
 * arrival lands on `start` (`end` then follows from the stops).
 */
export function startCopyDraft(source: LifecycleTrip, start: string, end: string): TripDraft {
  const draft: TripDraft = {
    ...startDraft(source.config, start, end, source.theme),
    mode: "copy",
    sourceId: source.id,
  };
  const stops = source.stops ?? [];
  if (stops.length < 2 || !parseDate(start)) return draft;
  return withStops(draft, shiftStops(stops, daysBetween(stops[0].arrive, start)));
}

export function setDraftTheme(draft: TripDraft, theme: ThemeId): TripDraft {
  return { ...draft, theme };
}

/** Start from this saved list (or, with null, from staples and recommendations again). A copy never has one. */
export function setDraftSavedList(draft: TripDraft, savedListId: string | null): TripDraft {
  if (draft.mode === "copy" || savedListId === null) {
    const { savedListId: _dropped, ...rest } = draft;
    return rest;
  }
  return { ...draft, savedListId };
}

/** Confirm the first stop's place (the only stop of a single-destination trip). */
export function selectDraftLocation(draft: TripDraft, location: SampleLocation): TripDraft {
  return setDraftStopLocation(draft, 0, location);
}

export function setDraftStopLocation(
  draft: TripDraft,
  index: number,
  location: SampleLocation,
): TripDraft {
  const current = draftStops(draft);
  if (index < 0 || index >= current.length) return draft;
  return withStops(
    draft,
    current.map((stop, at) => (at === index ? { ...stop, location: { ...location } } : stop)),
  );
}

/** Replace the whole route (add, remove or reorder stops). Needs at least one stop; the UI validates the rest. */
export function setDraftStops(draft: TripDraft, stops: readonly DraftStop[]): TripDraft {
  if (stops.length === 0) return draft;
  return withStops(
    draft,
    stops.map((stop) => ({ ...stop, location: stop.location ? { ...stop.location } : null })),
  );
}

/**
 * Set the trip's first arrival and last departure. With one stop this is exactly the old behaviour (a return before
 * departure becomes departure). With several, only the two outer dates move; the stops in between keep their dates
 * and `validateStops` reports any gap or overlap this creates.
 */
export function setDraftDates(draft: TripDraft, start: string, end: string): TripDraft {
  const dates = normalizeTripDates(start, end);
  const current = draftStops(draft);
  const last = current.length - 1;
  return withStops(
    draft,
    current.map((stop, at) => ({
      ...stop,
      ...(at === 0 ? { arrive: dates.start } : {}),
      ...(at === last ? { leave: dates.end } : {}),
    })),
  );
}

export function setDraftConfig(draft: TripDraft, config: TripConfig): TripDraft {
  return { ...draft, config: { ...config } };
}

export function beginDraft(state: LifecycleState, draft: TripDraft): LifecycleState {
  return { ...state, draft };
}

/** Cancel discards the draft and leaves saved trips untouched. */
export function cancelDraft(state: LifecycleState): LifecycleState {
  return state.draft ? { ...state, draft: null } : state;
}

// ---------------------------------------------------------------- building a trip snapshot

/**
 * A fresh trip snapshot. The item list is the calculator's `buildTripItems` (suggestions, return outfit, default
 * Pack last items, staples merged over them). The calculator can leave a quantity-0 row behind when a staple
 * resolves to zero; a snapshot must not contain phantom rows, so those are dropped here.
 *
 * `start` and `end` must already be valid, ordered dates (saveDraft normalizes them first); with an invalid range
 * the calculator reports 0 days, which the database schema (days >= 1) would reject.
 */
export function buildTrip(
  destination: string,
  location: SampleLocation | null,
  start: string,
  end: string,
  config: TripConfig,
  staples: readonly Staple[],
  deps: TripBuilderDeps,
  copiedFrom: string | null = null,
  theme: ThemeId = DEFAULT_THEME,
  stops?: readonly TripStop[],
  /** Replaces the calculated items (a saved list); the day counts still come from the dates. */
  listItems?: readonly TripItem[],
): LifecycleTrip {
  const built = buildTripItems({ ...config, start, end }, staples);
  const items: TripItem[] = listItems
    ? listItems.map((item) => ({ ...item }))
    : built.items
        .filter((entry) => entry.qty > 0)
        .map((entry) =>
          BATHROOM_NAMES.has(entry.name.toLowerCase())
            ? { ...entry, groupId: TOILETRY_GROUP_ID }
            : entry,
        );

  return {
    id: deps.newId(),
    destination,
    location: location ? { ...location } : null,
    stops: stops
      ? stops.map((stop) => ({ ...stop, location: { ...stop.location } }))
      : location
        ? [{ location: { ...location }, arrive: start, leave: end }]
        : [],
    start,
    end,
    config: { ...config },
    days: built.days,
    dailyDays: built.dailyDays,
    items,
    suggestionMemory: {},
    suppressedSuggestions: {},
    toiletryBagPacked: false,
    ready: false,
    weather: {
      status: "pending",
      label: forecastLabel(start, deps.today),
      suggestion: "Compact umbrella",
    },
    copiedFrom,
    archived: false,
    theme,
  };
}

/**
 * Save the draft as a new trip snapshot at the front of the list. Requires a confirmed location and
 * valid dates. Everything about packing progress starts clear; a copy only records `copiedFrom`.
 */
export function saveDraft(
  state: LifecycleState,
  staples: Staple[],
  deps: TripBuilderDeps,
  /** A saved list's items (#170): the trip starts from exactly these, with no staples or length-based items. */
  listItems?: readonly TripItem[],
): LifecycleResult {
  const draft = state.draft;
  if (!draft) return { ok: false, reason: "NO_DRAFT", state };
  const confirmed: TripStop[] = [];
  for (const stop of draftStops(draft)) {
    if (!stop.location) return { ok: false, reason: "LOCATION_NOT_CONFIRMED", state };
    confirmed.push({ location: stop.location, arrive: stop.arrive, leave: stop.leave });
  }
  // One stop keeps today's date rule (a return before departure becomes departure, a day trip is fine).
  if (confirmed.length === 1) {
    const dates = normalizeTripDates(confirmed[0].arrive, confirmed[0].leave);
    if (!dates.valid) return { ok: false, reason: "INVALID_DATES", state };
    confirmed[0] = { ...confirmed[0], arrive: dates.start, leave: dates.end };
  } else if (!validateStops(confirmed).ok) {
    return { ok: false, reason: "INVALID_DATES", state };
  }
  const dates = tripDatesFromStops(confirmed);

  const trip = buildTrip(
    routeLabel(confirmed),
    confirmed[0].location,
    dates.start,
    dates.end,
    draft.config,
    staples,
    deps,
    draft.sourceId,
    draft.theme,
    confirmed,
    listItems,
  );
  return { ok: true, state: { ...state, trips: [trip, ...state.trips], draft: null }, trip };
}

// ---------------------------------------------------------------- classification

/** A trip is past when its end date is strictly before `today`; an unparseable date is never past. */
export function isPastTrip(trip: Pick<LifecycleTrip, "end">, today: string): boolean {
  const end = parseDate(trip.end);
  const now = parseDate(today);
  return end !== null && now !== null && end.getTime() < now.getTime();
}

/** Archived wins over past: archiving is a manual flag independent of dates and of Ready. */
export function classifyTrip(
  trip: Pick<LifecycleTrip, "end" | "archived">,
  today: string,
): TripClassification {
  if (trip.archived) return "archived";
  return isPastTrip(trip, today) ? "past" : "upcoming";
}

export function upcomingTrips(trips: LifecycleTrip[], today: string): LifecycleTrip[] {
  return trips.filter((trip) => classifyTrip(trip, today) === "upcoming");
}

export function pastAndArchivedTrips(trips: LifecycleTrip[], today: string): LifecycleTrip[] {
  return trips.filter((trip) => classifyTrip(trip, today) !== "upcoming");
}

// ---------------------------------------------------------------- archive / restore

function setArchived(state: LifecycleState, tripId: string, archived: boolean): LifecycleResult {
  const trip = state.trips.find((entry) => entry.id === tripId);
  if (!trip) return { ok: false, reason: "TRIP_NOT_FOUND", state };
  if (trip.archived === archived) return { ok: true, state, trip };
  const updated = { ...trip, archived };
  return {
    ok: true,
    state: { ...state, trips: state.trips.map((entry) => (entry === trip ? updated : entry)) },
    trip: updated,
  };
}

/** Manual flag; does not look at or change Ready, packing progress, or dates. */
export function archiveTrip(state: LifecycleState, tripId: string): LifecycleResult {
  return setArchived(state, tripId, true);
}

/** Clears the manual flag. A future trip returns to Upcoming; a past one returns to past by date. */
export function restoreTrip(state: LifecycleState, tripId: string): LifecycleResult {
  return setArchived(state, tripId, false);
}

// ---------------------------------------------------------------- remove / undo

/** Move a trip to Recently deleted (newest first), stamped with `deletedAt`. */
export function removeTrip(
  state: LifecycleState,
  tripId: string,
  deletedAt: number,
): LifecycleResult {
  const trip = state.trips.find((entry) => entry.id === tripId);
  if (!trip) return { ok: false, reason: "TRIP_NOT_FOUND", state };
  return {
    ok: true,
    state: {
      ...state,
      trips: state.trips.filter((entry) => entry !== trip),
      deletedTrips: [{ trip, deletedAt }, ...state.deletedTrips],
    },
    trip,
  };
}

/**
 * Restore the exact removed trip. If a trip with the same id is already present, the deleted entry is
 * dropped without duplicating. Unknown ids (including a second undo) leave state unchanged.
 */
export function undoRemoveTrip(state: LifecycleState, tripId: string): LifecycleState {
  const entry = state.deletedTrips.find((candidate) => candidate.trip.id === tripId);
  if (!entry) return state;
  const deletedTrips = state.deletedTrips.filter((candidate) => candidate !== entry);
  const present = state.trips.some((trip) => trip.id === tripId);
  return { ...state, deletedTrips, trips: present ? state.trips : [...state.trips, entry.trip] };
}

/**
 * Retention seam (policy pending #28): drops deleted entries the caller's policy says to purge.
 * No retention rule is implemented here.
 */
export function purgeDeletedTrips(
  state: LifecycleState,
  shouldPurge: (entry: DeletedTrip) => boolean,
): LifecycleState {
  const deletedTrips = state.deletedTrips.filter((entry) => !shouldPurge(entry));
  return deletedTrips.length === state.deletedTrips.length ? state : { ...state, deletedTrips };
}
