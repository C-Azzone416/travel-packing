// The account's one home city (#379), kept on the owner's users row. City level only: the same place shape as a trip stop,
// with coordinates rounded to 2 decimals. Only an explicit set or clear writes. Every query is owner-scoped, and nothing here
// logs: a place never goes into a log line (see safe-log.ts).

import { eq } from "drizzle-orm";
import type { TripOrigin } from "../../domain/trip-route";
import type { SampleLocation } from "../../domain/trip-stops";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { homeFromRow, homeToColumns } from "./place-columns";

export async function readHomeCity(db: Db, ownerId: string): Promise<TripOrigin | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, ownerId));
  return row ? homeFromRow(row) : null;
}

/** Set the home city, or clear it with null. Returns what is stored afterwards. */
export async function writeHomeCity(
  db: Db,
  ownerId: string,
  place: SampleLocation | null,
): Promise<TripOrigin | null> {
  await db.update(schema.users).set(homeToColumns(place)).where(eq(schema.users.id, ownerId));
  return readHomeCity(db, ownerId);
}
