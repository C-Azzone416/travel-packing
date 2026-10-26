import "server-only";

import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/retention";
import { accountDeletions, accountSetups, users } from "@/server/db/schema";
import { lockAccountDeletion } from "./account-deletion-lock";

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
    // Provisioning takes the same lock before checking the fence. Whichever transaction goes second therefore sees
    // the first one's committed owner/fence state instead of acting on a stale READ COMMITTED snapshot.
    await lockAccountDeletion(transaction, userId);
    await transaction
      .insert(accountDeletions)
      .values({ userId })
      .onConflictDoNothing({ target: accountDeletions.userId });
    await transaction.delete(accountSetups).where(eq(accountSetups.emailDigest, setupEmailDigest));
    await transaction.delete(users).where(eq(users.id, userId));
  });
}
