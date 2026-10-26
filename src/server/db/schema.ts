// Relational schema (plan §18 "Suggested logical data sets"). See docs/schema.md for the ER summary.
//
// Rules this file encodes:
// - Every row carries a non-null owner_id referencing users.id. Child rows reference their parent through a
//   composite (id, owner_id) key, so a child can never point at another owner's trip.
// - Historical trip items are SNAPSHOTS: trip_items has no foreign key to staples, so staple edits never
//   rewrite trip rows. A trip item keeps a stable semantic_id (e.g. "underwear", "weather-umbrella") as plain
//   text plus its own immutable uuid, so similar names never merge.
// - Recoverable delete is trips.deleted_at. Purging is a seam with no built-in retention period (#28).

import { sql } from "drizzle-orm";
import { THEME_IDS } from "../../domain/themes";
import { STAPLES_SETUP_STATES } from "../../domain/staples-setup";
export { STAPLES_SETUP_STATES } from "../../domain/staples-setup";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const ITEM_SECTIONS = ["main", "return", "packlast"] as const;
export const STAPLE_CADENCES = ["per day", "per trip", "smart"] as const;
export const TEMPERATURE_UNITS = ["F", "C"] as const;
export const WEATHER_STATUSES = ["pending", "accepted", "skipped"] as const;
/** Category strings the domain uses. "Clothing" is the single semantic name (the prototype's "Clothes" was normalized to it). */
export const ITEM_CATEGORIES = [
  "Clothing",
  "Nice attire",
  "Bathroom",
  "Toiletries",
  "Tech",
  "Other essentials",
  "Accessories",
  "Pack last",
  "Return outfit",
  "Weather suggestion",
] as const;
/** The only item group the domain defines: toiletry-bag contents. */
export const TOILETRY_GROUP = "toiletry-bag";

export const itemSection = pgEnum("item_section", ITEM_SECTIONS);
export const stapleCadence = pgEnum("staple_cadence", STAPLE_CADENCES);
export const weatherStatus = pgEnum("weather_status", WEATHER_STATUSES);
export const itemCategory = pgEnum("item_category", ITEM_CATEGORIES);
export const staplesSetupState = pgEnum("staples_setup_state", STAPLES_SETUP_STATES);
/** The six built-in trip theme images (#48), shared with the domain so the two can never drift apart. */
export const tripTheme = pgEnum("trip_theme", THEME_IDS);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** App-side mirror of the auth user (id comes from the auth provider, #9). Owner of every other row. */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** The person agreed to send map coordinates and dates to the weather provider (epic #107). Off until chosen. */
    weatherOptIn: boolean("weather_opt_in").notNull().default(false),
    temperatureUnit: text("temperature_unit", { enum: TEMPERATURE_UNITS }).notNull().default("F"),
    /** The colour theme the person chose (#139). Null until they choose one, which means Base; unknown values read as Base. */
    appearance: text("appearance"),
    /** Independent of item count: an intentionally empty skipped/completed list is still initialized. */
    staplesSetupState: staplesSetupState("staples_setup_state").notNull().default("incomplete"),
    staplesReminderDismissed: boolean("staples_reminder_dismissed").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [check("users_temperature_unit_known", sql`${table.temperatureUnit} in ('F', 'C')`)],
);

/**
 * Accounts whose password was set through an emailed link (#83). Sign-in is refused for any address without a row here,
 * so a password chosen by someone else before the owner verified the address can never open a session. Keyed by an HMAC-SHA-256
 * digest of the normalized email, because there is no user id before the first session and the app stores no raw
 * addresses. A row is created only when a reset link (setup or forgot-password) is used successfully, and is removed only
 * in the same transaction that permanently deletes that account's app data.
 */
export const accountSetups = pgTable("account_setups", {
  emailDigest: text("email_digest").primaryKey(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Transient fence for an account whose irreversible deletion is in progress. It deliberately has no foreign key to `users`
 * so it survives the app-data purge while provider deletion is retried. Confirmed closure removes this row; only the opaque
 * provider user id and creation time bind recovery to that exact identity incarnation. The setup digest lets terminal
 * cleanup repeat its sweep after provider confirmation, and the nullable retry time fairly paces recovery. Every value
 * disappears with the fence.
 */
export const accountDeletions = pgTable("account_deletions", {
  userId: text("user_id").primaryKey(),
  identityCreatedAt: timestamp("identity_created_at", { withTimezone: true }).notNull(),
  setupEmailDigest: text("setup_email_digest").notNull(),
  /** Pending-only retry bookkeeping. Terminal cleanup deletes this with the rest of the fence. */
  lastReconcileAttemptAt: timestamp("last_reconcile_attempt_at", { withTimezone: true }),
});

const ownerId = () =>
  text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** Future-trip defaults. Versioned on their own; never referenced by trip rows. */
export const staples = pgTable(
  "staples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    semanticId: text("semantic_id").notNull(),
    name: text("name").notNull(),
    category: itemCategory("category").notNull(),
    qty: integer("qty").notNull(),
    cadence: stapleCadence("cadence").notNull(),
    packLast: boolean("pack_last").notNull().default(false),
    groupId: text("group_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("staples_owner_semantic_unique").on(table.ownerId, table.semanticId),
    check("staples_qty_positive", sql`${table.qty} >= 1`),
    check("staples_version_positive", sql`${table.version} >= 1`),
    check("staples_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "staples_group_known",
      sql`${table.groupId} is null or ${table.groupId} = ${sql.raw(`'${TOILETRY_GROUP}'`)}`,
    ),
  ],
);

/**
 * A named, owner-scoped list of items to add to new trips (#140). Like staples it is a template: applying it copies
 * items into the trip, and nothing here is referenced by trip rows, so editing or deleting a list never touches a trip.
 * Carries no packed counts, Ready state or trip metadata.
 */
export const savedLists = pgTable(
  "saved_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("saved_lists_id_owner_unique").on(table.id, table.ownerId),
    check("saved_lists_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("saved_lists_name_short", sql`char_length(${table.name}) <= 80`),
    index("saved_lists_owner_idx").on(table.ownerId),
  ],
);

/** One item of a saved list: identity (semantic_id), name, category and the needed quantity only. */
export const savedListItems = pgTable(
  "saved_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id").notNull(),
    ownerId: ownerId(),
    semanticId: text("semantic_id").notNull(),
    name: text("name").notNull(),
    category: itemCategory("category").notNull(),
    qty: integer("qty").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    foreignKey({
      name: "saved_list_items_list_fk",
      columns: [table.listId, table.ownerId],
      foreignColumns: [savedLists.id, savedLists.ownerId],
    }).onDelete("cascade"),
    unique("saved_list_items_list_semantic_unique").on(table.listId, table.semanticId),
    check("saved_list_items_qty_positive", sql`${table.qty} >= 1`),
    check("saved_list_items_name_not_blank", sql`btrim(${table.name}) <> ''`),
    index("saved_list_items_list_order_idx").on(table.listId, table.sortOrder),
  ],
);

/** One saved trip. start_date, end_date, destination and location_* are privacy-sensitive (docs/schema.md). */
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    destination: text("destination").notNull(),
    locationId: text("location_id"),
    locationLabel: text("location_label"),
    /** Set only for a place that came from a geocoding provider (#47). Curated places leave these null. */
    locationProvider: text("location_provider"),
    locationPlaceId: text("location_place_id"),
    locationRegion: text("location_region"),
    locationCountry: text("location_country"),
    locationCountryCode: text("location_country_code"),
    /** Rounded to 2 decimals (about 1 km) before storage. The most sensitive columns here (docs/schema.md). */
    latitude: numeric("latitude", { precision: 5, scale: 2 }),
    longitude: numeric("longitude", { precision: 5, scale: 2 }),
    timezone: text("timezone"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    days: integer("days").notNull(),
    dailyDays: integer("daily_days").notNull(),
    toiletryBagPacked: boolean("toiletry_bag_packed").notNull().default(false),
    ready: boolean("ready").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    copiedFrom: uuid("copied_from"),
    /** The picture shown on the trip card and header (#48). Not sensitive: one of six fixed names. */
    theme: tripTheme("theme").notNull().default("travel"),
    /**
     * The owner's override of the route stamps' labels (#151), one per stamp slot in route order. Null = automatic. Only the
     * override is stored: automatic labels are derived from the stops. Exactly three letters or numbers.
     */
    stampLabel1: text("stamp_label_1"),
    stampLabel2: text("stamp_label_2"),
    /** Recoverable delete: set = "recently deleted". Null = live. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Target of the composite (trip_id, owner_id) foreign keys on every child table.
    unique("trips_id_owner_unique").on(table.id, table.ownerId),
    foreignKey({
      name: "trips_copied_from_fk",
      columns: [table.copiedFrom],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    check("trips_dates_ordered", sql`${table.endDate} >= ${table.startDate}`),
    check("trips_days_positive", sql`${table.days} >= 1`),
    check(
      "trips_daily_days_range",
      sql`${table.dailyDays} >= 0 and ${table.dailyDays} <= ${table.days}`,
    ),
    check("trips_destination_not_blank", sql`btrim(${table.destination}) <> ''`),
    check(
      "trips_stamp_label_1_format",
      sql`${table.stampLabel1} is null or ${table.stampLabel1} ~ '^[A-Z0-9]{3}$'`,
    ),
    check(
      "trips_stamp_label_2_format",
      sql`${table.stampLabel2} is null or ${table.stampLabel2} ~ '^[A-Z0-9]{3}$'`,
    ),
    check("trips_latitude_range", sql`${table.latitude} between -90 and 90`),
    check("trips_longitude_range", sql`${table.longitude} between -180 and 180`),
    // Coordinates come as a pair, and only with a provider place: a curated trip has none.
    check(
      "trips_coordinates_pair",
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
    check(
      "trips_coordinates_need_provider",
      sql`${table.latitude} is null or ${table.locationProvider} is not null`,
    ),
    check(
      "trips_provider_pair",
      sql`(${table.locationProvider} is null) = (${table.locationPlaceId} is null)`,
    ),
    check(
      "trips_country_code_length",
      sql`${table.locationCountryCode} is null or char_length(${table.locationCountryCode}) = 2`,
    ),
    index("trips_owner_start_idx").on(table.ownerId, table.startDate),
    // Supports the purge seam: find soft-deleted trips without scanning live ones.
    index("trips_deleted_at_idx")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
  ],
);

/**
 * The ordered stops of a trip (epic #107). Same place columns and checks as trips.location_*, plus the city
 * (trips keeps it in `destination`, which is only a title). Contiguity across rows is enforced by the domain
 * (`validateStops`); the database holds each stop's own rules. Privacy class: same as trips.location_* and dates.
 */
export const tripStops = pgTable(
  "trip_stops",
  {
    tripId: uuid("trip_id").notNull(),
    ownerId: ownerId(),
    position: integer("position").notNull(),
    city: text("city").notNull(),
    locationId: text("location_id"),
    locationLabel: text("location_label"),
    locationProvider: text("location_provider"),
    locationPlaceId: text("location_place_id"),
    locationRegion: text("location_region"),
    locationCountry: text("location_country"),
    locationCountryCode: text("location_country_code"),
    /** Rounded to 2 decimals (about 1 km) before storage. The most sensitive columns here (docs/schema.md). */
    latitude: numeric("latitude", { precision: 5, scale: 2 }),
    longitude: numeric("longitude", { precision: 5, scale: 2 }),
    timezone: text("timezone"),
    arriveDate: date("arrive_date", { mode: "string" }).notNull(),
    leaveDate: date("leave_date", { mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ name: "trip_stops_pk", columns: [table.tripId, table.position] }),
    foreignKey({
      name: "trip_stops_trip_fk",
      columns: [table.tripId, table.ownerId],
      foreignColumns: [trips.id, trips.ownerId],
    }).onDelete("cascade"),
    check("trip_stops_position_range", sql`${table.position} >= 0`),
    // A single stop may be a day trip (leave = arrive); the domain requires a night per stop on multi-stop trips.
    check("trip_stops_dates_ordered", sql`${table.leaveDate} >= ${table.arriveDate}`),
    check("trip_stops_city_not_blank", sql`btrim(${table.city}) <> ''`),
    check("trip_stops_latitude_range", sql`${table.latitude} between -90 and 90`),
    check("trip_stops_longitude_range", sql`${table.longitude} between -180 and 180`),
    check(
      "trip_stops_coordinates_pair",
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
    check(
      "trip_stops_coordinates_need_provider",
      sql`${table.latitude} is null or ${table.locationProvider} is not null`,
    ),
    check(
      "trip_stops_provider_pair",
      sql`(${table.locationProvider} is null) = (${table.locationPlaceId} is null)`,
    ),
    check(
      "trip_stops_country_code_length",
      sql`${table.locationCountryCode} is null or char_length(${table.locationCountryCode}) = 2`,
    ),
    index("trip_stops_owner_idx").on(table.ownerId, table.tripId),
  ],
);

/** The planning preferences a trip was calculated from, plus the suggestion state item operations keep. */
export const tripPreferences = pgTable(
  "trip_preferences",
  {
    tripId: uuid("trip_id").primaryKey(),
    ownerId: ownerId(),
    laundry: boolean("laundry").notNull().default(false),
    spare: boolean("spare").notNull().default(false),
    niceAttire: boolean("nice_attire").notNull().default(false),
    occasionCount: integer("occasion_count").notNull().default(1),
    reuseNice: boolean("reuse_nice").notNull().default(false),
    returnOutfit: boolean("return_outfit").notNull().default(true),
    /** Remembered copies of calculated items across Nice outfits off/on (domain: suggestionMemory). */
    suggestionMemory: jsonb("suggestion_memory")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Ids of optional suggestions the user removed (domain: suppressedSuggestions). */
    suppressedSuggestions: text("suppressed_suggestions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "trip_preferences_trip_fk",
      columns: [table.tripId, table.ownerId],
      foreignColumns: [trips.id, trips.ownerId],
    }).onDelete("cascade"),
    check("trip_preferences_occasion_count_range", sql`${table.occasionCount} between 1 and 8`),
  ],
);

/** Immutable snapshot of one item on one trip. No link to staples. */
export const tripItems = pgTable(
  "trip_items",
  {
    /** Per-trip immutable item id. */
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull(),
    ownerId: ownerId(),
    /** Stable semantic id ("underwear", "weather-umbrella", ...); unique within a trip. */
    semanticId: text("semantic_id").notNull(),
    name: text("name").notNull(),
    category: itemCategory("category").notNull(),
    qty: integer("qty").notNull(),
    section: itemSection("section").notNull().default("main"),
    groupId: text("group_id"),
    optional: boolean("optional").notNull().default(false),
    userEdited: boolean("user_edited").notNull().default(false),
    /** A copied rule snapshot for Staple-derived rows. Null means a generic or manual trip item. */
    stapleCadence: stapleCadence("staple_cadence"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "trip_items_trip_fk",
      columns: [table.tripId, table.ownerId],
      foreignColumns: [trips.id, trips.ownerId],
    }).onDelete("cascade"),
    unique("trip_items_trip_semantic_unique").on(table.tripId, table.semanticId),
    // Target of the progress table's composite key, which carries qty so packed <= qty is a plain CHECK.
    unique("trip_items_progress_key").on(table.id, table.tripId, table.ownerId, table.qty),
    check("trip_items_qty_positive", sql`${table.qty} >= 1`),
    check("trip_items_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "trip_items_group_known",
      sql`${table.groupId} is null or ${table.groupId} = ${sql.raw(`'${TOILETRY_GROUP}'`)}`,
    ),
    index("trip_items_trip_order_idx").on(table.tripId, table.sortOrder),
  ],
);

/**
 * Mutable packing progress, kept apart from the item snapshot. qty is mirrored through a composite foreign key
 * (ON UPDATE CASCADE) so CHECK (0 <= packed <= qty) is enforced by the database; a trigger from migration 0001
 * lowers packed first when an item's qty is reduced.
 */
export const tripItemProgress = pgTable(
  "trip_item_progress",
  {
    itemId: uuid("item_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    ownerId: ownerId(),
    qty: integer("qty").notNull(),
    packed: integer("packed").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: "trip_item_progress_pk", columns: [table.itemId] }),
    foreignKey({
      name: "trip_item_progress_item_fk",
      columns: [table.itemId, table.tripId, table.ownerId, table.qty],
      foreignColumns: [tripItems.id, tripItems.tripId, tripItems.ownerId, tripItems.qty],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check(
      "trip_item_progress_packed_range",
      sql`${table.packed} >= 0 and ${table.packed} <= ${table.qty}`,
    ),
  ],
);

/**
 * The state of one weather-driven suggestion on a trip: one row per (trip, semantic id). `rule_signature` is a short
 * text naming the rule that fired (never raw weather), so a skipped suggestion stays skipped until it changes.
 * The legacy simulated umbrella (`weather-umbrella`) also keeps its `label`.
 */
export const weatherSuggestions = pgTable(
  "weather_suggestions",
  {
    tripId: uuid("trip_id").notNull(),
    ownerId: ownerId(),
    semanticId: text("suggestion_semantic_id").notNull().default("weather-umbrella"),
    status: weatherStatus("status").notNull().default("pending"),
    label: text("label").notNull().default(""),
    ruleSignature: text("rule_signature").notNull().default(""),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: "weather_suggestions_pk", columns: [table.tripId, table.semanticId] }),
    foreignKey({
      name: "weather_suggestions_trip_fk",
      columns: [table.tripId, table.ownerId],
      foreignColumns: [trips.id, trips.ownerId],
    }).onDelete("cascade"),
    check("weather_suggestions_signature_short", sql`char_length(${table.ruleSignature}) <= 200`),
  ],
);
