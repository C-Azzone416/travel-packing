import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/retention";

// Namespaces the two-int advisory-lock key so an unrelated use of hashtext(userId) cannot block this flow.
const ACCOUNT_DELETION_LOCK_NAMESPACE = 1_742_457_091;
const ACCOUNT_SETUP_LOCK_NAMESPACE = 1_742_457_092;

type LockableTransaction = Pick<Db, "execute">;

/**
 * Serialize owner provisioning and account deletion for one provider identity.
 *
 * This must run inside the caller's transaction and before either checking the transient deletion fence or mutating the
 * owner row. A transaction-level advisory lock is released automatically on commit/rollback. Hash collisions can only
 * serialize unrelated identities; they cannot let an in-progress identity through.
 */
export async function lockAccountDeletion(
  transaction: LockableTransaction,
  userId: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${ACCOUNT_DELETION_LOCK_NAMESPACE}, hashtext(${userId}))`,
  );
}

/** Serialize setup completion with both deletion sweeps for the same opaque email digest. */
export async function lockAccountSetup(
  transaction: LockableTransaction,
  setupEmailDigest: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${ACCOUNT_SETUP_LOCK_NAMESPACE}, hashtext(${setupEmailDigest}))`,
  );
}
