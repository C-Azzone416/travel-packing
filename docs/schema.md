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

`item_category` lists the strings the domain uses. The semantic category for everyday clothing is the single value
`Clothing` (the plan's name); the prototype's calculator label `Clothes` was normalized to it (PM decision), and a
test fails if any category the calculator or default staples produce is missing from the enum.

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

## Connections

- **App**: `DATABASE_URL` (pooled), opened by `createAppDb` in `src/server/db/neon.ts` (Neon serverless driver over
  WebSockets, so transactions work), wrapped in Drizzle with this schema.
- **Migrations**: `DATABASE_URL_UNPOOLED`, one direct (non-pooled) connection. `createMigrationConnection` refuses a
  Neon `-pooler` host. `npm run db:migrate:remote` applies pending migrations over it; it is not run by CI and must
  not be pointed at a shared or production database without Caroline's approval (#27-#29).
- Neither string has a default, is logged, or appears in the repository. Tests use PGlite and never connect.

## Data layer (`src/server/data`)

Every entry point is `run(context, zodSchema, input, handler)`:

1. authorize an allowlisted owner (owner id comes from the session, never from input);
2. validate input with zod (field paths in errors, never values);
3. run the handler scoped to that owner, in a transaction where several rows change;
4. return a typed `Result` (`UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | INVALID_INPUT | REJECTED | INTERNAL`) with
   generic messages: no trip dates, destinations, item names, or database text.

Trips are loaded and saved as one aggregate (trip + preferences + weather + items with progress). Another owner's
trip is indistinguishable from a missing one (`NOT_FOUND`), including as the source of a copy, so `copied_from` can
only ever reference the caller's own trip. First use seeds the default staples once (never re-adding removed ones).

## Synthetic seed data (`npm run db:seed`)

Loads the prototype's sample set (plan §6) for one owner: **San Diego** (upcoming, partially packed, Nice outfits on)
and **Lisbon** (past, fully packed, bag confirmed, Ready, simulated umbrella accepted), plus the default staples. All of
it is invented; nothing is real trip data.

- **Idempotent.** The two sample trips have ids derived from the owner id, so re-running replaces exactly those trips
  and sets the staples back to the defaults. Other trips the owner has, and other owners' data, are untouched.
- **Never the app's own database.** The target is chosen explicitly: a local on-disk PGlite database
  (`--pglite <dir>`, default `.data/seed-db`, git-ignored), or a remote dev/preview database named by
  `SEED_DATABASE_URL` (already migrated, and `--yes` is required). The app's `DATABASE_URL` is never read as a target.
- **Refuses production.** It stops when `NODE_ENV=production`, on any Vercel runtime, and when the target is the same
  database as `DATABASE_URL` or `DATABASE_URL_UNPOOLED` (pooled or direct host spelling). It prints a summary only,
  never a connection string, date, or place.
- `--owner <id>` or `SEED_OWNER_ID` sets the owner (default `seed-owner`). Tests can call `seedSyntheticData(db, ownerId)`
  directly as a fixture.
