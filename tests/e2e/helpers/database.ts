import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { utcDate } from "../../../src/server/seed/run-date";
import { seedSyntheticData } from "../../../src/server/seed/seed";
import type { Db } from "../../../src/server/db/retention";
import * as schema from "../../../src/server/db/schema";
import { E2E_DB_PORT } from "../support/ports";

export const E2E_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`;

/**
 * Put one seeded owner back exactly as the e2e database started: every trip they have is deleted (the ones a test
 * created, and the ones it changed), then the sample set and default staples are loaded again. Called before each
 * test signs in, so no test depends on, or leaves behind, another test's data. Tests run one at a time.
 */
export async function resetOwnerData(ownerId: string, today: string = utcDate()): Promise<void> {
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
      })
      .where(eq(schema.users.id, ownerId));
    // The sample trips are relative to the date the browser will think it is (see src/server/seed/run-date.ts): signInAsOwner passes
    // the page's own date, and a test that resets directly gets the real UTC date, so San Diego is upcoming whenever the run is.
    await seedSyntheticData(db, ownerId, today);
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
