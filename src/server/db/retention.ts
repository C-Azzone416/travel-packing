// Recoverable delete and the purge seam (plan §12; retention policy pending #28).
//
// Deleting a trip only stamps trips.deleted_at. Nothing here knows how long deleted trips are kept: the
// caller supplies the cutoff to purgeDeletedBefore, so no retention period is hard-coded.

import { and, eq, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DeletedTripRow {
  id: string;
  deletedAt: Date;
}

/** Move a live trip to Recently deleted. Returns false if it does not exist, is not yours, or is already deleted. */
export async function softDeleteTrip(
  db: Db,
  ownerId: string,
  tripId: string,
  deletedAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(schema.trips)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(schema.trips.id, tripId),
        eq(schema.trips.ownerId, ownerId),
        isNull(schema.trips.deletedAt),
      ),
    )
    .returning({ id: schema.trips.id });
  return rows.length > 0;
}

/** Undo a recoverable delete. Returns false if there is nothing to restore. */
export async function restoreDeletedTrip(
  db: Db,
  ownerId: string,
  tripId: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.trips)
    .set({ deletedAt: null })
    .where(
      and(
        eq(schema.trips.id, tripId),
        eq(schema.trips.ownerId, ownerId),
        isNotNull(schema.trips.deletedAt),
      ),
    )
    .returning({ id: schema.trips.id });
  return rows.length > 0;
}

/** The owner's Recently deleted list, newest first. */
export async function listRecentlyDeleted(db: Db, ownerId: string): Promise<DeletedTripRow[]> {
  const rows = await db
    .select({ id: schema.trips.id, deletedAt: schema.trips.deletedAt })
    .from(schema.trips)
    .where(and(eq(schema.trips.ownerId, ownerId), isNotNull(schema.trips.deletedAt)))
    .orderBy(schema.trips.deletedAt);
  return rows.map((row) => ({ id: row.id, deletedAt: row.deletedAt as Date })).reverse();
}

/**
 * ADMIN / CRON ONLY. This is the one helper here that is not scoped to the calling user: without `ownerId` it purges
 * every owner's expired trips. It must never be called from a user request path (`src/app`, the data-layer service,
 * server actions); a test enforces that. Retention policy (#28) decides who calls it and with which cutoff.
 *
 * Permanently delete trips soft-deleted strictly before `cutoff` (children cascade). Live trips are never
 * touched. `cutoff` is required: the retention period is a policy decision (#28), not a default here.
 * Optionally scoped to one owner. Returns the purged trip ids.
 */
export async function purgeDeletedBefore(
  db: Db,
  cutoff: Date,
  ownerId?: string,
): Promise<string[]> {
  const conditions: SQL[] = [isNotNull(schema.trips.deletedAt), lt(schema.trips.deletedAt, cutoff)];
  if (ownerId !== undefined) conditions.push(eq(schema.trips.ownerId, ownerId));
  const rows = await db
    .delete(schema.trips)
    .where(and(...conditions))
    .returning({ id: schema.trips.id });
  return rows.map((row) => row.id);
}
