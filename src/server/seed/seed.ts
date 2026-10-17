// Loads the synthetic sample set for one owner. Idempotent: re-running restores exactly this state.

import { inArray, and, eq } from "drizzle-orm";
import { DEFAULT_STAPLES } from "../../domain/calc";
import type { Staple } from "../../domain/trip";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { saveStaples } from "../data/staple-store";
import { insertTrip } from "../data/trip-store";
import { SAMPLE_TRIP_SLUGS, sampleTripId, sampleTrips } from "./sample-data";

export interface SeedSummary {
  ownerId: string;
  trips: number;
  staples: number;
}

/**
 * Replace the owner's sample trips (by their derived ids; dates are relative to `today`, YYYY-MM-DD) and set their staples to the prototype defaults.
 * Any other trips the owner has are left alone. Callers must have passed assertSeedAllowed first.
 */
export async function seedSyntheticData(
  db: Db,
  ownerId: string,
  today: string,
): Promise<SeedSummary> {
  await db.insert(schema.users).values({ id: ownerId }).onConflictDoNothing();

  const ids = SAMPLE_TRIP_SLUGS.map((slug) => sampleTripId(ownerId, slug));
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.trips)
      .where(and(inArray(schema.trips.id, ids), eq(schema.trips.ownerId, ownerId)));
    for (const trip of sampleTrips(ownerId, today)) await insertTrip(tx as Db, ownerId, trip);
  });

  const staples: Staple[] = DEFAULT_STAPLES.map((staple) => ({ ...staple }));
  await saveStaples(db, ownerId, staples);
  return { ownerId, trips: ids.length, staples: staples.length };
}
