// The owner's colour theme (#139), kept on their users row. A row with no saved value, or one holding something this
// build does not know, reads as Base. Only an explicit choice ever writes. Every query is owner-scoped.

import { eq } from "drizzle-orm";
import { parseAppearance, type Appearance } from "../../domain/appearance";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";

export async function readAppearance(db: Db, ownerId: string): Promise<Appearance> {
  const [row] = await db
    .select({ appearance: schema.users.appearance })
    .from(schema.users)
    .where(eq(schema.users.id, ownerId));
  return parseAppearance(row?.appearance);
}

export async function writeAppearance(
  db: Db,
  ownerId: string,
  appearance: Appearance,
): Promise<Appearance> {
  await db.update(schema.users).set({ appearance }).where(eq(schema.users.id, ownerId));
  return readAppearance(db, ownerId);
}
