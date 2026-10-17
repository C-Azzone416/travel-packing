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
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const ITEM_SECTIONS = ["main", "return", "packlast"] as const;
export const STAPLE_CADENCES = ["per day", "per trip"] as const;
export const WEATHER_STATUSES = ["pending", "accepted", "skipped"] as const;
/** Category strings as the domain uses them today (the prototype mixes "Clothes" and "Clothing"; see docs/schema.md). */
export const ITEM_CATEGORIES = [
  "Clothing",
  "Clothes",
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

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** App-side mirror of the auth user (id comes from the auth provider, #9). Owner of every other row. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: createdAt(),
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

/** One saved trip. start_date, end_date, destination and location_* are privacy-sensitive (docs/schema.md). */
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    destination: text("destination").notNull(),
    locationId: text("location_id"),
    locationLabel: text("location_label"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    days: integer("days").notNull(),
    dailyDays: integer("daily_days").notNull(),
    toiletryBagPacked: boolean("toiletry_bag_packed").notNull().default(false),
    ready: boolean("ready").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    copiedFrom: uuid("copied_from"),
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
    index("trips_owner_start_idx").on(table.ownerId, table.startDate),
    // Supports the purge seam: find soft-deleted trips without scanning live ones.
    index("trips_deleted_at_idx")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
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

/** The simulated weather suggestion for a trip (one per trip). Reviewing never mutates the item list. */
export const weatherSuggestions = pgTable(
  "weather_suggestions",
  {
    tripId: uuid("trip_id").primaryKey(),
    ownerId: ownerId(),
    status: weatherStatus("status").notNull().default("pending"),
    label: text("label").notNull(),
    suggestionSemanticId: text("suggestion_semantic_id").notNull().default("weather-umbrella"),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "weather_suggestions_trip_fk",
      columns: [table.tripId, table.ownerId],
      foreignColumns: [trips.id, trips.ownerId],
    }).onDelete("cascade"),
  ],
);
