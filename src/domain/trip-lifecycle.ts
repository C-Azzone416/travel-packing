// Trip lifecycle (plan §12, §3 Trip history): draft, save, copy, archive/restore, classify,
// remove/undo. Ported from reference/prototype/dist/app.js. Pure and immutable; no framework imports.
//
// Date normalization, the forecast label, and the item list come from the calculator module
// (src/domain/calc). Only the id generator and "today" are injected: the domain has no hidden clock.

import { buildTripItems, forecastLabel, normalizeTripDates } from "./calc";
import { TOILETRY_GROUP_ID } from "./toiletry-bag";
import type { Staple, Trip, TripConfig, TripItem } from "./trip";

export interface SampleLocation {
  id: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  label: string;
}

export interface LifecycleTrip extends Trip {
  destination: string;
  location: SampleLocation | null;
  copiedFrom: string | null;
  archived: boolean;
}

export interface TripDraft {
  mode: "create" | "copy";
  sourceId: string | null;
  /** Only a confirmed location object counts; free text never confirms a destination. */
  location: SampleLocation | null;
  start: string;
  end: string;
  config: TripConfig;
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

/** Start a new draft. Dates are normalized (a return before departure becomes departure). */
export function startDraft(config: TripConfig, start: string, end: string): TripDraft {
  const dates = normalizeTripDates(start, end);
  return {
    mode: "create",
    sourceId: null,
    location: null,
    start: dates.start,
    end: dates.end,
    config: { ...config },
  };
}

/** Start a copy draft: only the source's preference config is carried over; location and dates are chosen anew. */
export function startCopyDraft(source: LifecycleTrip, start: string, end: string): TripDraft {
  return { ...startDraft(source.config, start, end), mode: "copy", sourceId: source.id };
}

export function selectDraftLocation(draft: TripDraft, location: SampleLocation): TripDraft {
  return { ...draft, location: { ...location } };
}

export function setDraftDates(draft: TripDraft, start: string, end: string): TripDraft {
  const dates = normalizeTripDates(start, end);
  return { ...draft, start: dates.start, end: dates.end };
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
): LifecycleTrip {
  const built = buildTripItems({ ...config, start, end }, staples);
  const items: TripItem[] = built.items
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
): LifecycleResult {
  const draft = state.draft;
  if (!draft) return { ok: false, reason: "NO_DRAFT", state };
  if (!draft.location) return { ok: false, reason: "LOCATION_NOT_CONFIRMED", state };
  const dates = normalizeTripDates(draft.start, draft.end);
  if (!dates.valid) return { ok: false, reason: "INVALID_DATES", state };

  const trip = buildTrip(
    draft.location.city,
    draft.location,
    dates.start,
    dates.end,
    draft.config,
    staples,
    deps,
    draft.sourceId,
  );
  return { ok: true, state: { ...state, trips: [trip, ...state.trips], draft: null }, trip };
}

// ---------------------------------------------------------------- classification

function parseIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  const valid =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  return valid ? time : null;
}

/** A trip is past when its end date is strictly before `today`; an unparseable date is never past. */
export function isPastTrip(trip: Pick<LifecycleTrip, "end">, today: string): boolean {
  const end = parseIsoDate(trip.end);
  const now = parseIsoDate(today);
  return end !== null && now !== null && end < now;
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
