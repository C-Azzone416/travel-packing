import "server-only";

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/retention";
import { accountDeletions, accountSetups, users } from "@/server/db/schema";
import { lockAccountDeletion, lockAccountSetup } from "./account-deletion-lock";
import { providerIdentityState } from "./provider-identity";
import { accountClosureEnabled } from "./account-closure-rollout";

export type AccountDeletionReconciliation = "completed" | "pending" | "unavailable";
export interface AccountDeletionReconciliationSummary {
  completed: number;
  pending: number;
  unavailable: number;
}

/**
 * Start deletion atomically in the app database. The fence is inserted before the app owner is deleted and deliberately
 * survives it. Deleting `users` cascades through every owner-scoped live row, including archived and soft-deleted trips.
 * Safe to repeat after a provider failure or double submission.
 */
export async function beginAccountDeletion(
  db: Db,
  userId: string,
  identityCreatedAt: number,
  setupEmailDigest: string,
): Promise<"started" | "identity-mismatch"> {
  return db.transaction(async (transaction) => {
    // Provisioning takes the same lock before checking the fence. Whichever transaction goes second therefore sees
    // the first one's committed owner/fence state instead of acting on a stale READ COMMITTED snapshot.
    await lockAccountDeletion(transaction, userId);
    await lockAccountSetup(transaction, setupEmailDigest);
    await transaction
      .insert(accountDeletions)
      .values({ userId, identityCreatedAt: new Date(identityCreatedAt), setupEmailDigest })
      .onConflictDoNothing({ target: accountDeletions.userId });
    const fence = await transaction
      .select({
        identityCreatedAt: accountDeletions.identityCreatedAt,
        setupEmailDigest: accountDeletions.setupEmailDigest,
      })
      .from(accountDeletions)
      .where(eq(accountDeletions.userId, userId))
      .limit(1);
    if (
      fence.length !== 1 ||
      fence[0].identityCreatedAt.getTime() !== identityCreatedAt ||
      fence[0].setupEmailDigest !== setupEmailDigest
    )
      return "identity-mismatch";
    await transaction.delete(accountSetups).where(eq(accountSetups.emailDigest, setupEmailDigest));
    await transaction.delete(users).where(eq(users.id, userId));
    return "started";
  });
}

/**
 * Finish a provider-confirmed deletion. The final owner sweep covers a request that was already in flight when deletion
 * began; the transient fence is removed last so a later request cannot provision between the two statements. Safe to
 * repeat after a lost commit acknowledgement: an absent fence means cleanup already completed and must not delete a
 * newly registered account whose provider happened to reuse the same id.
 */
export async function completeAccountDeletion(
  db: Db,
  userId: string,
  identityCreatedAt: number,
  setupEmailDigest: string,
): Promise<"completed" | "absent" | "identity-mismatch"> {
  return db.transaction(async (transaction) => {
    await lockAccountDeletion(transaction, userId);
    await lockAccountSetup(transaction, setupEmailDigest);
    const fence = await transaction
      .select({
        identityCreatedAt: accountDeletions.identityCreatedAt,
        setupEmailDigest: accountDeletions.setupEmailDigest,
      })
      .from(accountDeletions)
      .where(eq(accountDeletions.userId, userId))
      .limit(1);
    if (fence.length === 0) return "absent";
    if (
      fence[0].identityCreatedAt.getTime() !== identityCreatedAt ||
      fence[0].setupEmailDigest !== setupEmailDigest
    )
      return "identity-mismatch";
    await transaction.delete(accountSetups).where(eq(accountSetups.emailDigest, setupEmailDigest));
    await transaction.delete(users).where(eq(users.id, userId));
    await transaction.delete(accountDeletions).where(eq(accountDeletions.userId, userId));
    return "completed";
  });
}

/**
 * Resolve a response-lost provider deletion against Managed Neon Auth's immediate database source of truth. Only an
 * authoritative absence of this exact identity incarnation permits terminal app cleanup; every query/error ambiguity keeps
 * the fence. This also handles provider-id reuse because the creation timestamp is part of the lookup and cleanup contract.
 */
export async function reconcileAccountDeletion(
  db: Db,
  userId: string,
  identityCreatedAt: number,
  setupEmailDigest: string,
): Promise<AccountDeletionReconciliation> {
  if (!accountClosureEnabled()) return "unavailable";
  const providerState = await providerIdentityState(db, userId, identityCreatedAt);
  if (providerState === "present") return "pending";
  if (providerState === "unavailable") return "unavailable";
  try {
    const completion = await completeAccountDeletion(
      db,
      userId,
      identityCreatedAt,
      setupEmailDigest,
    );
    if (completion === "identity-mismatch") return "unavailable";
    const remaining = await db
      .select({
        identityCreatedAt: accountDeletions.identityCreatedAt,
        setupEmailDigest: accountDeletions.setupEmailDigest,
      })
      .from(accountDeletions)
      .where(eq(accountDeletions.userId, userId))
      .limit(1);
    if (remaining.length === 0) return "completed";
    return remaining[0].identityCreatedAt.getTime() === identityCreatedAt &&
      remaining[0].setupEmailDigest === setupEmailDigest
      ? "pending"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Bounded request-time reconciler for identities that can no longer authenticate after a response-lost deletion. It is safe
 * to call from a public signed-out page: decisions come only from server-side fence rows and the branch-local auth table,
 * never browser input. Errors preserve the fence and are intentionally not exposed to the visitor.
 */
export async function reconcilePendingAccountDeletions(
  db: Db,
  limit = 10,
): Promise<AccountDeletionReconciliationSummary> {
  const summary: AccountDeletionReconciliationSummary = {
    completed: 0,
    pending: 0,
    unavailable: 0,
  };
  if (!accountClosureEnabled()) return summary;
  let fences: {
    userId: string;
    identityCreatedAt: Date;
    setupEmailDigest: string;
  }[];
  try {
    const batchSize = Math.max(1, Math.min(100, Math.trunc(limit) || 10));
    const result = (await db.execute(sql`
      with candidates as (
        select
          deletion.user_id,
          deletion.identity_created_at,
          deletion.setup_email_digest
        from account_deletions deletion
        where (
          deletion.last_reconcile_attempt_at is null
          or deletion.last_reconcile_attempt_at <= now() - interval '5 minutes'
        )
          and not exists (
            select 1
            from neon_auth."user" provider
            where provider.id = deletion.user_id
              and provider."createdAt" = deletion.identity_created_at
          )
        order by deletion.last_reconcile_attempt_at asc nulls first, deletion.user_id asc
        for update of deletion skip locked
        limit ${batchSize}
      )
      update account_deletions deletion
      set last_reconcile_attempt_at = now()
      from candidates
      where deletion.user_id = candidates.user_id
      returning
        candidates.user_id as "userId",
        candidates.identity_created_at as "identityCreatedAt",
        candidates.setup_email_digest as "setupEmailDigest"
    `)) as { rows?: unknown } | readonly unknown[];
    const rows = Array.isArray(result)
      ? result
      : Array.isArray((result as { rows?: unknown }).rows)
        ? ((result as { rows: unknown[] }).rows ?? [])
        : [];
    fences = rows.flatMap((row) => {
      const candidate = row as {
        userId?: unknown;
        identityCreatedAt?: unknown;
        setupEmailDigest?: unknown;
      };
      if (typeof candidate.userId !== "string" || typeof candidate.setupEmailDigest !== "string")
        return [];
      const identityCreatedAt =
        candidate.identityCreatedAt instanceof Date
          ? candidate.identityCreatedAt
          : typeof candidate.identityCreatedAt === "string"
            ? new Date(candidate.identityCreatedAt)
            : null;
      return identityCreatedAt && Number.isFinite(identityCreatedAt.getTime())
        ? [
            {
              userId: candidate.userId,
              identityCreatedAt,
              setupEmailDigest: candidate.setupEmailDigest,
            },
          ]
        : [];
    });
    summary.unavailable += rows.length - fences.length;
  } catch {
    summary.unavailable = 1;
    return summary;
  }
  for (const fence of fences) {
    const result = await reconcileAccountDeletion(
      db,
      fence.userId,
      fence.identityCreatedAt.getTime(),
      fence.setupEmailDigest,
    );
    summary[result] += 1;
  }
  return summary;
}
