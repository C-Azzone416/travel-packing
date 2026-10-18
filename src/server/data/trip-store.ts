// Trip aggregate persistence. A trip is loaded as one object (trip row + preferences + weather + items with
// progress), changed by the pure domain functions, and written back in one transaction. Every query is scoped
// by owner_id, including queries on child tables (defense in depth beside the composite foreign keys).

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { ThemeId } from "../../domain/themes";
import type { Trip, TripConfig, TripItem } from "../../domain/trip";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { ITEM_CATEGORIES } from "../db/schema";
import { fail } from "./result";
import { refuse } from "./run";

/**
 * The structured place behind a trip's destination (#47). Provider fields and coordinates are set only for a
 * place a geocoding provider returned; a curated place has region and country but no provider or coordinates.
 * Coordinates are always rounded to 2 decimals (about 1 km). These are the most sensitive columns in the schema.
 */
export interface StoredPlace {
  provider: string | null;
  placeId: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

/** A domain Trip plus the stored fields the UI and lifecycle need. */
export interface StoredTrip extends Trip {
  destination: string;
  locationId: string | null;
  locationLabel: string | null;
  /** Optional so callers that never set a place are unaffected; loading always sets it (null when none). */
  place?: StoredPlace | null;
  copiedFrom: string | null;
  archived: boolean;
  theme: ThemeId;
  deletedAt: Date | null;
}

const WEATHER_SUGGESTION_TEXT = "Compact umbrella";
const CATEGORIES: ReadonlySet<string> = new Set(ITEM_CATEGORIES);

type TripRow = typeof schema.trips.$inferSelect;

export type TripFilter = "live" | "deleted";

// ---------------------------------------------------------------- reading

export async function loadTrips(
  db: Db,
  ownerId: string,
  options: { tripId?: string; filter: TripFilter },
): Promise<StoredTrip[]> {
  const conditions = [
    eq(schema.trips.ownerId, ownerId),
    options.filter === "live" ? isNull(schema.trips.deletedAt) : isNotNull(schema.trips.deletedAt),
  ];
  if (options.tripId) conditions.push(eq(schema.trips.id, options.tripId));
  const tripRows = await db
    .select()
    .from(schema.trips)
    .where(and(...conditions))
    .orderBy(desc(schema.trips.createdAt), schema.trips.id);
  if (tripRows.length === 0) return [];

  const ids = tripRows.map((row) => row.id);
  const owned = (column: PgColumn) => eq(column, ownerId);
  // Sequential on purpose: inside a transaction these share one connection, and issuing queries concurrently on a
  // single node-postgres client is deprecated (removed in pg@9).
  const preferences = await db
    .select()
    .from(schema.tripPreferences)
    .where(and(inArray(schema.tripPreferences.tripId, ids), owned(schema.tripPreferences.ownerId)));
  const weather = await db
    .select()
    .from(schema.weatherSuggestions)
    .where(
      and(inArray(schema.weatherSuggestions.tripId, ids), owned(schema.weatherSuggestions.ownerId)),
    );
  const items = await db
    .select({ item: schema.tripItems, packed: schema.tripItemProgress.packed })
    .from(schema.tripItems)
    .leftJoin(schema.tripItemProgress, eq(schema.tripItemProgress.itemId, schema.tripItems.id))
    .where(and(inArray(schema.tripItems.tripId, ids), owned(schema.tripItems.ownerId)))
    .orderBy(schema.tripItems.tripId, schema.tripItems.sortOrder);

  return tripRows.map((row) => {
    const prefs = preferences.find((entry) => entry.tripId === row.id);
    const weatherRow = weather.find((entry) => entry.tripId === row.id);
    return toStoredTrip(
      row,
      prefs,
      weatherRow,
      items.filter((entry) => entry.item.tripId === row.id),
    );
  });
}

/**
 * Lock the owner's live trip row until the surrounding transaction ends. Every change reads the whole trip and
 * rewrites it, so without this two rapid edits (say two quick "+" taps) could both read the same state and the second
 * write would silently drop the first. With the lock they run one after the other. Returns false if there is no
 * such live trip for this owner.
 */
export async function lockTrip(db: Db, ownerId: string, tripId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.trips.id })
    .from(schema.trips)
    .where(
      and(
        eq(schema.trips.id, tripId),
        eq(schema.trips.ownerId, ownerId),
        isNull(schema.trips.deletedAt),
      ),
    )
    .for("update");
  return rows.length > 0;
}

export async function loadTrip(
  db: Db,
  ownerId: string,
  tripId: string,
  filter: TripFilter = "live",
): Promise<StoredTrip | null> {
  return (await loadTrips(db, ownerId, { tripId, filter }))[0] ?? null;
}

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

function toStoredPlace(row: TripRow): StoredPlace | null {
  const place: StoredPlace = {
    provider: row.locationProvider,
    placeId: row.locationPlaceId,
    region: row.locationRegion,
    country: row.locationCountry,
    countryCode: row.locationCountryCode,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    timezone: row.timezone,
  };
  return Object.values(place).every((value) => value === null) ? null : place;
}

/** Column values for a place; only called for a trip that carries one, so a caller without a place never nulls them. */
function placeColumns(place: StoredPlace | null) {
  return {
    locationProvider: place?.provider ?? null,
    locationPlaceId: place?.placeId ?? null,
    locationRegion: place?.region ?? null,
    locationCountry: place?.country ?? null,
    locationCountryCode: place?.countryCode ?? null,
    latitude: place?.latitude == null ? null : String(place.latitude),
    longitude: place?.longitude == null ? null : String(place.longitude),
    timezone: place?.timezone ?? null,
  };
}

function toStoredTrip(
  row: TripRow,
  prefs: typeof schema.tripPreferences.$inferSelect | undefined,
  weather: typeof schema.weatherSuggestions.$inferSelect | undefined,
  itemRows: { item: typeof schema.tripItems.$inferSelect; packed: number | null }[],
): StoredTrip {
  const config: TripConfig = {
    laundry: prefs?.laundry ?? false,
    spare: prefs?.spare ?? false,
    niceAttire: prefs?.niceAttire ?? false,
    occasionCount: prefs?.occasionCount ?? 1,
    reuseNice: prefs?.reuseNice ?? false,
    returnOutfit: prefs?.returnOutfit ?? true,
  };
  return {
    id: row.id,
    destination: row.destination,
    locationId: row.locationId,
    locationLabel: row.locationLabel,
    place: toStoredPlace(row),
    start: row.startDate,
    end: row.endDate,
    config,
    days: row.days,
    dailyDays: row.dailyDays,
    items: itemRows.map(({ item, packed }) => toDomainItem(item, packed ?? 0)),
    suggestionMemory: (prefs?.suggestionMemory ?? {}) as Record<string, TripItem>,
    suppressedSuggestions: Object.fromEntries(
      (prefs?.suppressedSuggestions ?? []).map((id) => [id, true]),
    ),
    toiletryBagPacked: row.toiletryBagPacked,
    ready: row.ready,
    weather: {
      status: weather?.status ?? "pending",
      label: weather?.label ?? "",
      suggestion: WEATHER_SUGGESTION_TEXT,
    },
    copiedFrom: row.copiedFrom,
    archived: row.archived,
    theme: row.theme,
    deletedAt: row.deletedAt,
  };
}

function toDomainItem(row: typeof schema.tripItems.$inferSelect, packed: number): TripItem {
  const item: TripItem = {
    id: row.semanticId,
    name: row.name,
    category: row.category,
    qty: row.qty,
    packed,
    section: row.section,
  };
  if (row.optional) item.optional = true;
  if (row.userEdited) item.userEdited = true;
  if (row.groupId) item.groupId = row.groupId;
  return item;
}

// ---------------------------------------------------------------- writing

/** Insert a new trip aggregate. `trip.id` must be a uuid chosen by the caller. */
export async function insertTrip(db: Db, ownerId: string, trip: StoredTrip): Promise<void> {
  assertWritable(trip);
  await db.transaction(async (tx) => {
    await tx.insert(schema.trips).values({
      id: trip.id,
      ownerId,
      destination: trip.destination,
      locationId: trip.locationId,
      locationLabel: trip.locationLabel,
      ...(trip.place === undefined ? {} : placeColumns(trip.place)),
      startDate: trip.start,
      endDate: trip.end,
      days: trip.days,
      dailyDays: trip.dailyDays,
      toiletryBagPacked: trip.toiletryBagPacked,
      ready: trip.ready,
      archived: trip.archived,
      copiedFrom: trip.copiedFrom,
      theme: trip.theme,
    });
    await writeChildren(tx as Db, ownerId, trip);
  });
}

/** Replace a trip aggregate's mutable state. Returns false if the trip is not this owner's live trip. */
export async function saveTrip(db: Db, ownerId: string, trip: StoredTrip): Promise<boolean> {
  assertWritable(trip);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.trips)
      .set({
        destination: trip.destination,
        locationId: trip.locationId,
        locationLabel: trip.locationLabel,
        ...(trip.place === undefined ? {} : placeColumns(trip.place)),
        startDate: trip.start,
        endDate: trip.end,
        days: trip.days,
        dailyDays: trip.dailyDays,
        toiletryBagPacked: trip.toiletryBagPacked,
        ready: trip.ready,
        archived: trip.archived,
        theme: trip.theme,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.trips.id, trip.id),
          eq(schema.trips.ownerId, ownerId),
          isNull(schema.trips.deletedAt),
        ),
      )
      .returning({ id: schema.trips.id });
    if (updated.length === 0) return false;
    await writeChildren(tx as Db, ownerId, trip);
    return true;
  });
}

function assertWritable(trip: StoredTrip): void {
  const badCategory = trip.items.find((item) => !CATEGORIES.has(item.category));
  if (badCategory) refuse(fail("INVALID_INPUT", { fields: ["items.category"] }));
}

async function writeChildren(tx: Db, ownerId: string, trip: StoredTrip): Promise<void> {
  const tripId = trip.id;

  await tx
    .insert(schema.tripPreferences)
    .values({
      tripId,
      ownerId,
      ...trip.config,
      suggestionMemory: trip.suggestionMemory,
      suppressedSuggestions: Object.keys(trip.suppressedSuggestions).filter(
        (id) => trip.suppressedSuggestions[id],
      ),
    })
    .onConflictDoUpdate({
      target: schema.tripPreferences.tripId,
      set: {
        ...trip.config,
        suggestionMemory: trip.suggestionMemory,
        suppressedSuggestions: Object.keys(trip.suppressedSuggestions).filter(
          (id) => trip.suppressedSuggestions[id],
        ),
        updatedAt: new Date(),
      },
    });

  await tx
    .insert(schema.weatherSuggestions)
    .values({ tripId, ownerId, status: trip.weather.status, label: trip.weather.label })
    .onConflictDoUpdate({
      target: schema.weatherSuggestions.tripId,
      set: { status: trip.weather.status, label: trip.weather.label, updatedAt: new Date() },
    });

  const existing = await tx
    .select({ id: schema.tripItems.id, semanticId: schema.tripItems.semanticId })
    .from(schema.tripItems)
    .where(and(eq(schema.tripItems.tripId, tripId), eq(schema.tripItems.ownerId, ownerId)));
  const keep = new Set(trip.items.map((item) => item.id));
  const removed = existing.filter((row) => !keep.has(row.semanticId)).map((row) => row.id);
  if (removed.length > 0) {
    await tx
      .delete(schema.tripItems)
      .where(and(inArray(schema.tripItems.id, removed), eq(schema.tripItems.ownerId, ownerId)));
  }

  for (const [index, item] of trip.items.entries()) {
    const values = {
      name: item.name,
      category: item.category as (typeof ITEM_CATEGORIES)[number],
      qty: item.qty,
      section: item.section,
      groupId: item.groupId ?? null,
      optional: Boolean(item.optional),
      userEdited: Boolean(item.userEdited),
      sortOrder: index,
    };
    const [saved] = await tx
      .insert(schema.tripItems)
      .values({ tripId, ownerId, semanticId: item.id, ...values })
      .onConflictDoUpdate({
        target: [schema.tripItems.tripId, schema.tripItems.semanticId],
        set: values,
      })
      .returning({ id: schema.tripItems.id });
    await tx
      .insert(schema.tripItemProgress)
      .values({ itemId: saved.id, tripId, ownerId, qty: item.qty, packed: item.packed })
      .onConflictDoUpdate({
        target: schema.tripItemProgress.itemId,
        set: { qty: item.qty, packed: item.packed, updatedAt: new Date() },
      });
  }
}
