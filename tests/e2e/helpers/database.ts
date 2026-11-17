import { and, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { SAMPLE_TODAY } from "../../../src/server/seed/sample-data";
import { seedSyntheticData } from "../../../src/server/seed/seed";
import type { Db } from "../../../src/server/db/retention";
import * as schema from "../../../src/server/db/schema";
import { homeToColumns } from "../../../src/server/data/place-columns";
import type { SampleLocation } from "../../../src/domain/trip-stops";
import { E2E_DB_PORT } from "../support/ports";

export const E2E_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`;

/**
 * Put one seeded owner back exactly as the e2e database started: every trip they have is deleted (the ones a test
 * created, and the ones it changed), then the sample set and default staples are loaded again. Called before each
 * test signs in, so no test depends on, or leaves behind, another test's data. Tests run one at a time.
 */
export async function resetOwnerData(ownerId: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db.delete(schema.trips).where(eq(schema.trips.ownerId, ownerId));
    // Feedback starts not connected for every test (#260): the server-held enrollment and any unfinished redemption go too.
    await db
      .delete(schema.framebriarEnrollments)
      .where(eq(schema.framebriarEnrollments.ownerId, ownerId));
    await db
      .delete(schema.framebriarRedemptions)
      .where(eq(schema.framebriarRedemptions.ownerId, ownerId));
    // Saved lists (#167) start empty for every test too.
    await db.delete(schema.savedLists).where(eq(schema.savedLists.ownerId, ownerId));
    // Weather starts opted out, in Fahrenheit, and the theme unchosen (Base), for every test (both live on the user).
    await db
      .update(schema.users)
      .set({
        weatherOptIn: false,
        temperatureUnit: "F",
        appearance: null,
        staplesSetupState: "completed",
        staplesReminderDismissed: false,
        // The home city (#379) is the account's: no test inherits the one a previous test set.
        ...homeToColumns(null),
      })
      .where(eq(schema.users.id, ownerId));
    await seedSyntheticData(db, ownerId, SAMPLE_TODAY);
  } finally {
    await pool.end();
  }
}

/** Reset a project-isolated account to a genuine first-use Staples state, with no implicit items. */
export async function resetStaplesSetup(ownerId: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .insert(schema.users)
      .values({ id: ownerId })
      .onConflictDoUpdate({
        target: schema.users.id,
        set: { staplesSetupState: "incomplete", staplesReminderDismissed: false },
      });
    await db.delete(schema.staples).where(eq(schema.staples.ownerId, ownerId));
  } finally {
    await pool.end();
  }
}

/** Change only setup lifecycle metadata; useful for checking migrated-owner invitations without touching their list. */
export async function setStaplesSetupLifecycle(
  ownerId: string,
  state: (typeof schema.STAPLES_SETUP_STATES)[number],
  reminderDismissed = false,
): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .update(schema.users)
      .set({ staplesSetupState: state, staplesReminderDismissed: reminderDismissed })
      .where(eq(schema.users.id, ownerId));
  } finally {
    await pool.end();
  }
}

/**
 * Synthetic acceptance fixture: only one Main-list Staple and a fully packed San Diego trip with no toiletry rows.
 * The trip is deliberately not Ready, so the review can prove that no bag-placement step blocks its Ready action.
 */
export async function prepareMainOnlyReadyPath(ownerId: string): Promise<string> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    const [trip] = await db
      .select({ id: schema.trips.id })
      .from(schema.trips)
      .where(and(eq(schema.trips.ownerId, ownerId), eq(schema.trips.destination, "San Diego")));
    if (!trip) throw new Error("synthetic San Diego trip is missing");

    await db.transaction(async (tx) => {
      await tx.delete(schema.staples).where(eq(schema.staples.ownerId, ownerId));
      await tx.insert(schema.staples).values({
        ownerId,
        semanticId: "notebook",
        name: "Notebook",
        category: "Other essentials",
        qty: 1,
        cadence: "per trip",
        packLast: false,
        groupId: null,
      });
      await tx
        .delete(schema.tripItems)
        .where(
          and(
            eq(schema.tripItems.ownerId, ownerId),
            eq(schema.tripItems.tripId, trip.id),
            eq(schema.tripItems.groupId, "toiletry-bag"),
          ),
        );
      await tx
        .update(schema.tripItemProgress)
        .set({ packed: sql`${schema.tripItemProgress.qty}` })
        .where(
          and(
            eq(schema.tripItemProgress.ownerId, ownerId),
            eq(schema.tripItemProgress.tripId, trip.id),
          ),
        );
      await tx
        .update(schema.trips)
        .set({ ready: false, toiletryBagPacked: false })
        .where(and(eq(schema.trips.ownerId, ownerId), eq(schema.trips.id, trip.id)));
    });
    return trip.id;
  } finally {
    await pool.end();
  }
}

/** Make an otherwise empty synthetic owner behave like a migrated account instead of triggering first-use setup. */
export async function ensureExistingOwner(ownerId: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .insert(schema.users)
      .values({ id: ownerId, staplesSetupState: "skipped", staplesReminderDismissed: true })
      .onConflictDoUpdate({
        target: schema.users.id,
        set: { staplesSetupState: "skipped", staplesReminderDismissed: true },
      });
  } finally {
    await pool.end();
  }
}

/**
 * Choose the owner's theme on the account directly, as if they had picked it on Settings (which is covered by settings.spec).
 * The Settings screen shows the account's theme, so a spec that wants a theme there needs this and not only the cookie.
 */
export async function setOwnerAppearance(ownerId: string, appearance: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db.update(schema.users).set({ appearance }).where(eq(schema.users.id, ownerId));
  } finally {
    await pool.end();
  }
}

/** Turn weather on for the account, as Settings does (the weather service itself is up to the spec: mock /api/weather). */
export async function setOwnerWeatherOptIn(ownerId: string, weatherOptIn: boolean): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db.update(schema.users).set({ weatherOptIn }).where(eq(schema.users.id, ownerId));
  } finally {
    await pool.end();
  }
}

/** Set the owner's home city (the default From of Plan a trip, #379), or clear it with null. */
export async function setOwnerHomeCity(
  ownerId: string,
  place: SampleLocation | null,
): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db.update(schema.users).set(homeToColumns(place)).where(eq(schema.users.id, ownerId));
  } finally {
    await pool.end();
  }
}

/** What the owner's trip with this destination stored for where it leaves from, how, and its name. */
export async function readTripTravel(
  ownerId: string,
  destination: string,
): Promise<{ origin: string | null; mode: string | null; name: string | null } | null> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(
      "SELECT origin_city AS origin, travel_mode AS mode, name FROM trips WHERE owner_id = $1 AND destination = $2",
      [ownerId, destination],
    );
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

/** The retained compatibility theme for one of the owner's trips. The Plan UI never reads or edits it. */
export async function readTripTheme(ownerId: string, destination: string): Promise<string | null> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(
      "SELECT theme FROM trips WHERE owner_id = $1 AND destination = $2 ORDER BY created_at DESC LIMIT 1",
      [ownerId, destination],
    );
    return result.rows[0]?.theme ?? null;
  } finally {
    await pool.end();
  }
}

/** Set how one of the owner's trips is travelled, as the Plan a trip screen will (#390); screenshots of the flight Home use it. */
export async function setTripTravelMode(
  ownerId: string,
  destination: string,
  mode: "fly" | "drive" | "other",
): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .update(schema.trips)
      .set({ travelMode: mode })
      .where(
        and(eq(schema.trips.ownerId, ownerId), like(schema.trips.destination, `${destination}%`)),
      );
  } finally {
    await pool.end();
  }
}

/** Move one of the owner's trips to new dates (the seed's are relative to a fixed day; the server's clock is the real one). */
export async function setTripDates(
  ownerId: string,
  destination: string,
  start: string,
  end: string,
): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .update(schema.trips)
      .set({ startDate: start, endDate: end })
      .where(
        and(eq(schema.trips.ownerId, ownerId), like(schema.trips.destination, `${destination}%`)),
      );
  } finally {
    await pool.end();
  }
}

/** Mark one of the owner's trips Ready directly (the weather review revokes it; getting there by packing is slow). */
export async function markTripReady(ownerId: string, destination: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db
      .update(schema.trips)
      .set({ ready: true })
      .where(and(eq(schema.trips.ownerId, ownerId), eq(schema.trips.destination, destination)));
  } finally {
    await pool.end();
  }
}

export interface SeedListItem {
  id: string;
  name: string;
  category: (typeof schema.ITEM_CATEGORIES)[number];
  qty: number;
}

/** Put one saved list (with its items) in the owner's account, as if it had been saved from a trip (#167). */
export async function seedSavedList(
  ownerId: string,
  name: string,
  items: SeedListItem[],
): Promise<string> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    const [row] = await db
      .insert(schema.savedLists)
      .values({ ownerId, name })
      .returning({ id: schema.savedLists.id });
    if (items.length > 0) {
      await db.insert(schema.savedListItems).values(
        items.map((item, index) => ({
          listId: row.id,
          ownerId,
          semanticId: item.id,
          name: item.name,
          category: item.category,
          qty: item.qty,
          sortOrder: index,
        })),
      );
    }
    return row.id;
  } finally {
    await pool.end();
  }
}

/** Delete every trip the owner has (the seeded samples too), so the Home is the first-run Home (#409). */
export async function clearOwnerTrips(ownerId: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db.delete(schema.trips).where(eq(schema.trips.ownerId, ownerId));
  } finally {
    await pool.end();
  }
}
