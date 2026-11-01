# Database schema

Source of truth: `src/server/db/schema.ts` (Drizzle). Migrations: `drizzle/` (up) and `drizzle/down/` (down).
Design basis: plan §18 "Suggested logical data sets" and §20 items 5–6 (item identity, historical snapshots).

## Tables

| Table                    | Plan data set       | Purpose                                                                                                                              |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                  | users               | App-side mirror of the auth user (id supplied by the auth provider, #9). Owner of every row.                                         |
| `account_setups`         | (auth, #83)         | Addresses whose password was set through an emailed link (digest of the email). Not owner data: no `owner_id`.                       |
| `account_deletions`      | (auth, #237)        | Transient identity-incarnation/setup fence while deletion is incomplete; removed after confirmed closure.                            |
| `staples`                | staples             | Future-trip defaults. Versioned on their own (`version`). Never referenced by trip rows.                                             |
| `saved_lists`            | (saved lists, #140) | A named list of items to add to new trips. Owner-scoped template; never referenced by trip rows.                                     |
| `saved_list_items`       | (saved lists, #140) | The items of a saved list: identity (`semantic_id`), name, category, `qty` only. No packed counts or trip data.                      |
| `trips`                  | trips               | One saved trip; also carries Ready, toiletry-bag placement, archive flag, `deleted_at`.                                              |
| `trip_preferences`       | trip_preferences    | The preferences a trip was calculated from, plus suggestion memory / suppressed suggestions.                                         |
| `trip_items`             | trip_items          | Immutable snapshot of each item on a trip.                                                                                           |
| `trip_item_progress`     | trip_item_progress  | Mutable packed counts, kept apart from the item snapshot.                                                                            |
| `trip_stops`             | trips (stops)       | The ordered stops (1-6) of a trip: place, arrive and leave dates (epic #107).                                                        |
| `weather_suggestions`    | weather_suggestions | The status of each weather suggestion on a trip: one row per (trip, semantic id), plus a short rule signature.                       |
| `framebriar_enrollments` | (feedback, #259)    | One account's Framebriar enrollment, **AES-256-GCM sealed**, keyed by `(owner_id, generation)`. See `docs/framebriar-enrollment.md`. |
| `framebriar_redemptions` | (feedback, #259)    | A started, uncommitted invitation redemption: its attempt id, written before the network call. One per account.                      |
| _(recently deleted)_     | —                   | Not a table: `trips.deleted_at` (see Recoverable delete).                                                                            |

Export/backup metadata (the last logical data set) is not modelled; it waits on the export decisions in plan §19.

## ER summary

```text
users 1──* staples                         (no link to trip tables: snapshots)
users 1──* saved_lists ──* saved_list_items (composite (list_id, owner_id) key; no link to trip tables)
users 1──* trips ──* trip_items ──1 trip_item_progress
               ├──1 trip_preferences
               ├──* trip_stops            (unique (trip_id, position))
               ├──* weather_suggestions   (unique (trip_id, semantic id))
               └── copied_from ──> trips   (self reference, ON DELETE SET NULL)
```

`users.generation` is a random uuid set when the row is provisioned (#259). The two Framebriar tables reference `users(id, generation)`, so a
row can only exist for the account generation that made it and a recreated account never matches an old row.

Every owned-data table below `users` has a non-null `owner_id` referencing `users.id` (`ON DELETE CASCADE`). The two auth
bookkeeping tables are exceptions. `account_setups` is keyed by an HMAC digest of the normalized email (there is no user id
before the first session, and the app keeps no raw addresses); the reset-link flow adds it (`docs/auth-screens.md`) and account
deletion removes the matching digest. `account_deletions` stores the opaque provider user id, provider identity creation time,
keyed setup digest, and nullable last reconciliation-attempt time while deletion is incomplete; it has no foreign key by
design, so deleting `users` cannot remove the fence. Confirmed closure removes it explicitly.

### Ownership is enforced by the keys

Child tables reference their trip through a **composite `(trip_id, owner_id)` foreign key** to `trips(id, owner_id)`.
A child row therefore cannot name another owner's trip. Authorization still lives in server code (#10); this is the
database refusing to store a cross-owner link.

### Snapshots, identity, and staples

- `trip_items` has **no foreign key to `staples`**. Editing or deleting a staple never touches a trip row
  (tested). The `semantic_id` ("underwear", "weather-umbrella", ...) is plain text copied at trip creation.
  `staple_cadence` snapshots the rule (`per trip`, `per day`, or `smart`) only for rows generated from a Staple,
  so later preference recalculation never imports current account defaults into an existing trip.
- `trip_items.id` is a per-trip immutable uuid. `(trip_id, semantic_id)` is unique, so two items with similar
  names (everyday vs return underwear) never merge: they have different semantic ids.
- `staples` is unique on `(owner_id, semantic_id)` and carries `version`, bumped by the data layer on each edit.
- `users.staples_setup_state` distinguishes a new, uninitialized account from an intentionally empty completed or
  skipped list. `users.staples_reminder_dismissed` is independent, so hiding the reminder never changes setup or items.
  Migration `0010` marks existing owners `skipped`; owners created afterward default to `incomplete`.

### Packed never exceeds qty

`trip_item_progress` mirrors `qty` through the composite key `(item_id, trip_id, owner_id, qty)` ->
`trip_items(id, trip_id, owner_id, qty)` with `ON UPDATE CASCADE`, so a plain `CHECK (0 <= packed <= qty)` works.
Migration `0001` adds a `BEFORE UPDATE OF qty` trigger that lowers `packed` first when an item's qty is reduced,
so quantity edits succeed instead of failing the cascade.

## Constraints

| Rule                                   | Where                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `qty >= 1`                             | `staples_qty_positive`, `saved_list_items_qty_positive`, `trip_items_qty_positive`         |
| `0 <= packed <= qty`                   | `trip_item_progress_packed_range`                                                          |
| `occasion_count` 1..8                  | `trip_preferences_occasion_count_range`                                                    |
| `end_date >= start_date`               | `trips_dates_ordered`                                                                      |
| Stamp label overrides (#151)           | `trips_stamp_label_1_format`, `trips_stamp_label_2_format`: null or exactly 3 of `A-Z0-9`  |
| `days >= 1`, `0 <= daily_days <= days` | `trips_days_positive`, `trips_daily_days_range`                                            |
| Non-blank names / destination          | `*_not_blank`                                                                              |
| `group_id` is null or `toiletry-bag`   | `staples_group_known`, `trip_items_group_known`                                            |
| Stop `leave_date >= arrive_date`       | `trip_stops_dates_ordered` (a night per stop on multi-stop trips: `validateStops`)         |
| Stop place rules                       | `trip_stops_*` mirror the `trips_*` location checks                                        |
| Temperature unit `F` or `C`            | `users_temperature_unit_known`                                                             |
| Enums                                  | `item_section`, `staple_cadence`, `staples_setup_state`, `weather_status`, `item_category` |
| Non-null owner on every row            | `owner_id NOT NULL` + FK to `users`                                                        |

`item_category` lists the strings the domain uses. The semantic category for everyday clothing is the single value
`Clothing` (the plan's name); the prototype's calculator label `Clothes` was normalized to it (PM decision), and a
test fails if any category the calculator or synthetic fixture Staples produce is missing from the enum.

## Privacy-sensitive columns

These reveal where and when someone travels. Keep them out of logs, analytics, fixtures, and client bundles.

| Column                                                                           | Why                                                                               |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `trips.start_date`, `trips.end_date`                                             | Exact travel dates                                                                |
| `trips.destination`                                                              | Destination city                                                                  |
| `trips.location_id`, `trips.location_label`                                      | City / region / country                                                           |
| `trips.location_provider`, `trips.location_place_id`                             | Which provider place was chosen                                                   |
| `trips.location_region`, `trips.location_country`, `trips.location_country_code` | Region / country                                                                  |
| `trips.latitude`, `trips.longitude`                                              | **Most sensitive.** About 1 km (rounded to 2 decimals before storage)             |
| `trips.timezone`                                                                 | Narrows the destination                                                           |
| `trips.stamp_label_1`, `trips.stamp_label_2`                                     | Optional 3-character stamp text the owner typed (#151); null = automatic          |
| `trip_stops.city`, `trip_stops.location_*`                                       | Same class as `trips.location_*`: where the person goes, per stop                 |
| `trip_stops.latitude`, `trip_stops.longitude`                                    | **Most sensitive**, as on trips (2 decimals; only for a provider place)           |
| `trip_stops.arrive_date`, `trip_stops.leave_date`                                | Exact travel dates, per stop                                                      |
| `trip_stops.timezone`                                                            | Narrows the destination                                                           |
| `weather_suggestions.rule_signature`                                             | Short name of the rule that fired. Never raw weather                              |
| `users.weather_opt_in`, `users.temperature_unit`                                 | Settings only; opt-in gates sending coordinates and dates to the weather provider |
| `trips.days`, `trips.daily_days`                                                 | Reveal trip length                                                                |
| `trips.copied_from`                                                              | Links trips to each other                                                         |
| `trips.deleted_at`                                                               | Deletion time                                                                     |
| `trip_items.name` (and staple names)                                             | Packing habits                                                                    |
| `trip_preferences.*`                                                             | Packing habits                                                                    |
| `weather_suggestions.label`                                                      | Tied to a trip's timing                                                           |

`users.id` and `owner_id` identify the account holder.

`account_deletions` is temporary security state identifying one in-progress provider identity incarnation. Provider failures
keep its opaque user id, identity creation time, keyed setup digest, and pending-only retry time so stale sessions cannot
recreate data, cleanup cannot target a reused id, and bounded signed-out reconciliation makes progress without hot-looping a
failing row. A terminal provider response triggers a final owner/setup sweep and deletes this row before the app reports
success.

## Recoverable delete and the purge seam

Removing a trip sets `trips.deleted_at`; undo clears it. A partial index on `deleted_at` keeps the Recently deleted
query and the purge cheap. `src/server/db/retention.ts` exposes `softDeleteTrip`, `restoreDeletedTrip`,
`listRecentlyDeleted`, and `purgeDeletedBefore(db, cutoff, ownerId?)`. **No retention period is hard-coded**: the
cutoff is a required argument, so the policy (#28) decides it. Purging hard-deletes the trip and cascades to its
children.

Closing an account is different from recoverable trip deletion: it inserts a transient deletion fence, removes the matching
`account_setups` digest, and hard-deletes `users` in one transaction. The existing cascades then remove every owned row,
including soft-deleted trips. After terminal provider deletion, a final locked sweep removes any late owner row and the fence.

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
only ever reference the caller's own trip. A new owner starts with an uninitialized, empty Staples list and can
complete or skip setup; the app never inserts personal defaults automatically.

## Synthetic seed data (`npm run db:seed`)

Loads the prototype's sample set (plan §6) for one owner: **San Diego** (upcoming, partially packed, Nice outfits on)
and **Lisbon** (past, fully packed, bag confirmed, Ready, simulated umbrella accepted), plus a synthetic fixture set of
Staples. All of it is invented; nothing is real trip data.

- **Idempotent.** The two sample trips have ids derived from the owner id, so re-running replaces exactly those trips
  and sets the staples back to the synthetic fixture set. Other trips the owner has, and other owners' data, are untouched.
- **Relative dates.** The sample trips' dates are computed from the run date: San Diego starts 7 days out (so it is always
  upcoming, with a "Close forecast") and Lisbon started 43 days ago (always past); both are five days long. With the
  prototype's "today" (2026-10-16) they land on its exact dates, Oct 23-27 and Sep 3-7, 2026.
- **Never the app's own database.** The target is chosen explicitly: a local on-disk PGlite database
  (`--pglite <dir>`, default `.data/seed-db`, git-ignored), or a remote dev/preview database named by
  `SEED_DATABASE_URL` (already migrated). A remote target also needs `--yes` **and** its host in `SEED_ALLOWED_HOSTS`
  (an exact, normalized host list; if it is unset or empty every remote target is refused, so `--yes` alone is never
  enough). The app's `DATABASE_URL` is never read as a target.
- **Refuses production.** It stops when `NODE_ENV=production`, on any Vercel runtime, and when the target is the same
  database as `DATABASE_URL` or `DATABASE_URL_UNPOOLED` (compared after normalizing the host and database name, so
  upper-case, `-POOLER`, trailing-dot, trailing-slash and percent-encoded spellings are all caught), and when the URL carries
  a `host`, `hostaddr`, `dbname` or `service` query override. It prints a summary only,
  never a connection string, date, or place.
- `--owner <id>` or `SEED_OWNER_ID` sets the owner (default `seed-owner` for a local database; a remote seed refuses to run without an explicit owner, and the preview deploy goes through `npm run db:seed:preview`, see `docs/deploy.md`). Tests can call `seedSyntheticData(db, ownerId)`
  directly as a fixture.
  The seed **resets that owner's staples to the synthetic fixture set**, so never point `--owner` / `SEED_OWNER_ID` at a real account
  id. If `DATABASE_URL` is unset where you seed, `SEED_ALLOWED_HOSTS` is the only protection: list only disposable hosts.

## Places (#47)

A trip's place is stored next to its destination: `location_id` / `location_label` (always, for a located trip),
`location_region` / `location_country` / `location_country_code`, and, **only for a place a geocoding provider
returned**, `location_provider`, `location_place_id`, `latitude`, `longitude`, `timezone`. Migration `0002` adds
them as nullable columns, so existing trips and curated-list trips stay valid with every provider column null.

Database rules (all `CHECK`s): latitude within -90..90 and longitude within -180..180; latitude and longitude come as
a pair; coordinates exist only with a provider; `location_provider` and `location_place_id` come as a pair; a country
code is two letters. Coordinates are `numeric(5,2)`, so the column itself rounds to 2 decimals (about 1 km).

**The server resolves the place; the browser only names it.** `createTrip` and `copyTrip` accept a place **id**
and nothing else is trusted (extra fields are stripped by validation). The server looks the id up
(`DataContext.resolveLocation`: the curated list, plus the provider for `open-meteo-<id>` ids when
`LOCATION_PROVIDER=open-meteo`) and stores the canonical result, re-rounding coordinates itself. An unknown id is
`INVALID_INPUT`; a lookup that is down is `UNAVAILABLE` and nothing is saved. The lookup happens before any database
write. Provider calls never happen inside the data layer's SQL transaction, and the queries and places are never logged.

## Trip stops (#109, epic #107)

A trip has 1-6 ordered **stops** in `trip_stops` (`(trip_id, position)` is the key; the composite `(trip_id, owner_id)`
foreign key cascades like every other child table). Each stop carries the same place columns and checks as
`trips.location_*`, plus `city` (the route is built from city names; `trips.destination` is only the editable title and
defaults to the route, "Lisbon → Porto"), and `arrive_date` / `leave_date`.

- **Contiguity is the domain's job** (`validateStops` in `src/domain/trip-stops.ts`): a stop's leave date is the next
  stop's arrive date (the travel day), every stop of a multi-stop trip is at least one night, at most six stops. A
  **single stop may be a day trip** (leave = arrive), exactly as a trip with `start = end` is valid today; the database
  check is therefore `leave_date >= arrive_date`.
- `trips.start_date` / `end_date` are **stored and derived**: the data layer writes them as the first arrive and last
  leave whenever stops are saved. `trips.location_*` keep the first stop's place (the single-destination view).
- **Day to stop** (`stopIndexForDay`): day `d` belongs to the stop where `arrive <= d < leave`; the last day belongs to
  the last stop, so a travel day counts toward the stop you arrive at.
- Migration `0005` backfills **one stop per existing trip** from `start_date`, `end_date` and `location_*`, so existing
  trips behave exactly as before. A trip written without stops (a single place on the trip row) gets its one stop from
  the trip's own columns.
- Entry points: `createTrip` / `copyTrip` take either the single-destination form (`location`, `start`, `end`) or
  `stops` (a place **id**, arrive, leave each; places are resolved server-side, once per distinct id);
  `setTripStops` replaces a saved trip's stops atomically and recalculates days and calculated items.

## Weather settings and suggestion status (#109)

- `users.weather_opt_in` (default false) and `users.temperature_unit` (`F` default, or `C`) are the person's settings
  (`getWeatherSettings` / `updateWeatherSettings`). Until the person opts in, nothing is sent to a weather provider.
- `weather_suggestions` is one row per `(trip_id, suggestion_semantic_id)` holding `status` and `rule_signature` (a
  short text naming the rule that fired, at most 200 characters, **never raw weather**). The simulated umbrella row
  was re-keyed in place (`weather-umbrella`) and still carries its legacy `label`. Entry points:
  `listTripWeatherSuggestions` / `setTripWeatherSuggestion`, both owner-scoped (another owner's trip is `NOT_FOUND`).
- Raw weather is not stored anywhere.
