import "server-only";

import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/retention";
import { accountDeletions, accountSetups, users } from "@/server/db/schema";

/**
 * Start deletion atomically in the app database. The fence is inserted before the app owner is deleted and deliberately
 * survives it. Deleting `users` cascades through every owner-scoped live row, including archived and soft-deleted trips.
 * Safe to repeat after a provider failure or double submission.
 */
export async function beginAccountDeletion(
  db: Db,
  userId: string,
  setupEmailDigest: string,
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .insert(accountDeletions)
      .values({ userId })
      .onConflictDoNothing({ target: accountDeletions.userId });
    await transaction.delete(accountSetups).where(eq(accountSetups.emailDigest, setupEmailDigest));
    await transaction.delete(users).where(eq(users.id, userId));
  });
}
