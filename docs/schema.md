# Database schema

Source of truth: `src/server/db/schema.ts` (Drizzle). Migrations: `drizzle/` (up) and `drizzle/down/` (down).
Design basis: plan §18 "Suggested logical data sets" and §20 items 5–6 (item identity, historical snapshots).

## Tables

| Table                 | Plan data set       | Purpose                                                                                      |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `users`               | users               | App-side mirror of the auth user (id supplied by the auth provider, #9). Owner of every row. |
| `staples`             | staples             | Future-trip defaults. Versioned on their own (`version`). Never referenced by trip rows.     |
| `trips`               | trips               | One saved trip; also carries Ready, toiletry-bag placement, archive flag, `deleted_at`.      |
| `trip_preferences`    | trip_preferences    | The preferences a trip was calculated from, plus suggestion memory / suppressed suggestions. |
| `trip_items`          | trip_items          | Immutable snapshot of each item on a trip.                                                   |
| `trip_item_progress`  | trip_item_progress  | Mutable packed counts, kept apart from the item snapshot.                                    |
| `weather_suggestions` | weather_suggestions | The simulated weather suggestion for a trip (one row per trip).                              |
| _(recently deleted)_  | —                   | Not a table: `trips.deleted_at` (see Recoverable delete).                                    |

Export/backup metadata (the last logical data set) is not modelled; it waits on the export decisions in plan §19.

## ER summary

```text
users 1──* staples                         (no link to trip tables: snapshots)
users 1──* trips ──* trip_items ──1 trip_item_progress
               ├──1 trip_preferences
               ├──1 weather_suggestions
               └── copied_from ──> trips   (self reference, ON DELETE SET NULL)
```

Every table has a non-null `owner_id` referencing `users.id` (`ON DELETE CASCADE`).

### Ownership is enforced by the keys

Child tables reference their trip through a **composite `(trip_id, owner_id)` foreign key** to `trips(id, owner_id)`.
A child row therefore cannot name another owner's trip. Authorization still lives in server code (#10); this is the
database refusing to store a cross-owner link.

### Snapshots, identity, and staples

- `trip_items` has **no foreign key to `staples`**. Editing or deleting a staple never touches a trip row
  (tested). The `semantic_id` ("underwear", "weather-umbrella", ...) is plain text copied at trip creation.
- `trip_items.id` is a per-trip immutable uuid. `(trip_id, semantic_id)` is unique, so two items with similar
  names (everyday vs return underwear) never merge: they have different semantic ids.
- `staples` is unique on `(owner_id, semantic_id)` and carries `version`, bumped by the data layer on each edit.

### Packed never exceeds qty

`trip_item_progress` mirrors `qty` through the composite key `(item_id, trip_id, owner_id, qty)` ->
`trip_items(id, trip_id, owner_id, qty)` with `ON UPDATE CASCADE`, so a plain `CHECK (0 <= packed <= qty)` works.
Migration `0001` adds a `BEFORE UPDATE OF qty` trigger that lowers `packed` first when an item's qty is reduced,
so quantity edits succeed instead of failing the cascade.

## Constraints

| Rule                                   | Where                                                               |
| -------------------------------------- | ------------------------------------------------------------------- |
| `qty >= 1`                             | `staples_qty_positive`, `trip_items_qty_positive`                   |
| `0 <= packed <= qty`                   | `trip_item_progress_packed_range`                                   |
| `occasion_count` 1..8                  | `trip_preferences_occasion_count_range`                             |
| `end_date >= start_date`               | `trips_dates_ordered`                                               |
| `days >= 1`, `0 <= daily_days <= days` | `trips_days_positive`, `trips_daily_days_range`                     |
| Non-blank names / destination          | `*_not_blank`                                                       |
| `group_id` is null or `toiletry-bag`   | `staples_group_known`, `trip_items_group_known`                     |
| Enums                                  | `item_section`, `staple_cadence`, `weather_status`, `item_category` |
| Non-null owner on every row            | `owner_id NOT NULL` + FK to `users`                                 |

`item_category` lists the strings the domain uses today. The prototype mixes `Clothes` (calculated rows) and
`Clothing` (staples); both are kept so nothing is silently remapped. Normalizing them is an open product/data
question for the PM, not decided here.

## Privacy-sensitive columns

These reveal where and when someone travels. Keep them out of logs, analytics, fixtures, and client bundles.

| Column                                      | Why                       |
| ------------------------------------------- | ------------------------- |
| `trips.start_date`, `trips.end_date`        | Exact travel dates        |
| `trips.destination`                         | Destination city          |
| `trips.location_id`, `trips.location_label` | City / region / country   |
| `trips.days`, `trips.daily_days`            | Reveal trip length        |
| `trips.copied_from`                         | Links trips to each other |
| `trips.deleted_at`                          | Deletion time             |
| `trip_items.name` (and staple names)        | Packing habits            |
| `trip_preferences.*`                        | Packing habits            |
| `weather_suggestions.label`                 | Tied to a trip's timing   |

`users.id` and `owner_id` identify the account holder.

## Recoverable delete and the purge seam

Removing a trip sets `trips.deleted_at`; undo clears it. A partial index on `deleted_at` keeps the Recently deleted
query and the purge cheap. `src/server/db/retention.ts` exposes `softDeleteTrip`, `restoreDeletedTrip`,
`listRecentlyDeleted`, and `purgeDeletedBefore(db, cutoff, ownerId?)`. **No retention period is hard-coded**: the
cutoff is a required argument, so the policy (#28) decides it. Purging hard-deletes the trip and cascades to its
children.

## Migrations

- Edit `src/server/db/schema.ts`, then `npm run db:generate` to produce the next `drizzle/NNNN_*.sql`
  (`drizzle-kit generate --custom` for hand-written SQL such as triggers).
- Write the matching `drizzle/down/NNNN_*.sql` by hand. Statements are separated by `--> statement-breakpoint`.
- `npm run db:check` validates the migration set; `npm run db:generate` reporting "No schema changes" proves
  `schema.ts` and the migrations agree.
- `npm run db:migrate` applies all migrations to an empty in-memory Postgres (PGlite), rolls them all back, and
  applies them again. It reads no connection string.
- Each migration runs in a transaction together with its `schema_migrations` bookkeeping row.
- Tests (`src/server/db/*.test.ts`) run against PGlite. **No Neon credentials are used or needed**; connecting to a
  real database (and its credentials) arrives with the data layer (#10) and is Caroline's call (#27-#29).
