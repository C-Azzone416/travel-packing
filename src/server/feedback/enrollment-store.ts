// Database access for the Framebriar enrollment (#259). Rows hold only sealed credentials plus plain metadata (deadline, state).
// Every write that changes an enrollment names the revision it read and loses cleanly if another instance wrote first, so two
// phones, two server instances or a refresh racing a disconnect cannot corrupt the credential state.

import { and, eq, sql } from "drizzle-orm";
import { REDEMPTION_WINDOW_MS } from "../../domain/redemption-window";
import { lockAccountDeletion } from "../auth/account-deletion-lock";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";

export type EnrollmentState = (typeof schema.FRAMEBRIAR_ENROLLMENT_STATES)[number];

export interface EnrollmentRow {
  ownerId: string;
  generation: string;
  keyVersion: string;
  credentials: string;
  expiresAt: Date;
  state: EnrollmentState;
  revision: number;
}

export { REDEMPTION_WINDOW_MS };

/** Thrown by every enrollment write while this owner's account deletion is in progress (an `account_deletions` fence exists). */
export class AccountClosingError extends Error {
  constructor() {
    super("account is closing");
    this.name = "AccountClosingError";
  }
}

/**
 * Runs an enrollment write inside one transaction that first takes the SAME per-owner advisory lock account deletion and owner
 * provisioning use (#311), and then refuses while the deletion fence exists. The order is the deletion transaction's own (owner
 * lock first; the setup lock and the owner row lock come after it there), so the two can wait on each other but never deadlock.
 * A write that goes second sees the committed fence instead of recreating a fenced owner row or sealing a credential that the
 * deletion's cascade would destroy unrevoked.
 */
async function whileNotClosing<T>(
  db: Db,
  ownerId: string,
  work: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await lockAccountDeletion(transaction, ownerId);
    const fence = await transaction
      .select({ userId: schema.accountDeletions.userId })
      .from(schema.accountDeletions)
      .where(eq(schema.accountDeletions.userId, ownerId))
      .limit(1);
    if (fence.length > 0) throw new AccountClosingError();
    return work(transaction as unknown as Db);
  });
}

/**
 * The account's generation, provisioning the app user row first (a recreated account gets a new, never-reused one). Refuses with
 * `AccountClosingError`, creating nothing, while the account's deletion is in progress.
 */
export async function accountGeneration(db: Db, ownerId: string): Promise<string> {
  return whileNotClosing(db, ownerId, async (tx) => {
    await tx.insert(schema.users).values({ id: ownerId }).onConflictDoNothing();
    const [row] = await tx
      .select({ generation: schema.users.generation })
      .from(schema.users)
      .where(eq(schema.users.id, ownerId));
    if (!row) throw new Error("account row missing");
    return row.generation;
  });
}

export async function loadEnrollment(
  db: Db,
  ownerId: string,
  generation: string,
): Promise<EnrollmentRow | null> {
  const [row] = await db
    .select()
    .from(schema.framebriarEnrollments)
    .where(
      and(
        eq(schema.framebriarEnrollments.ownerId, ownerId),
        eq(schema.framebriarEnrollments.generation, generation),
      ),
    );
  return row ?? null;
}

/**
 * Replaces the sealed credentials and metadata when the row is still at `expectedRevision`. Returns the new revision, or null
 * when another writer got there first (the caller re-reads and decides).
 */
export async function updateEnrollment(
  db: Db,
  row: EnrollmentRow,
  change: Partial<Pick<EnrollmentRow, "keyVersion" | "credentials" | "expiresAt" | "state">>,
): Promise<number | null> {
  return whileNotClosing(db, row.ownerId, async (tx) => {
    const updated = await tx
      .update(schema.framebriarEnrollments)
      .set({
        ...change,
        revision: sql`${schema.framebriarEnrollments.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.framebriarEnrollments.ownerId, row.ownerId),
          eq(schema.framebriarEnrollments.generation, row.generation),
          eq(schema.framebriarEnrollments.revision, row.revision),
        ),
      )
      .returning({ revision: schema.framebriarEnrollments.revision });
    return updated[0]?.revision ?? null;
  });
}

/** Deletes the enrollment when it is still at the revision that was read. */
export async function eraseEnrollment(db: Db, row: EnrollmentRow): Promise<boolean> {
  const erased = await db
    .delete(schema.framebriarEnrollments)
    .where(
      and(
        eq(schema.framebriarEnrollments.ownerId, row.ownerId),
        eq(schema.framebriarEnrollments.generation, row.generation),
        eq(schema.framebriarEnrollments.revision, row.revision),
      ),
    )
    .returning({ ownerId: schema.framebriarEnrollments.ownerId });
  return erased.length > 0;
}

/**
 * Whether the server holds ANY Framebriar record for this owner's current generation: an enrollment in any state, or any redemption
 * attempt (even one past its retry window, which can still stand for a family nobody holds a credential for). Read-only: it never
 * provisions the owner row, so asking about a closing or closed account cannot recreate it. Account closure (#261) refuses while
 * this is true, so sealed credentials are never deleted by a cascade. Throws when the database cannot answer (callers fail closed).
 */
export async function accountHoldsFeedback(db: Db, ownerId: string): Promise<boolean> {
  const [user] = await db
    .select({ generation: schema.users.generation })
    .from(schema.users)
    .where(eq(schema.users.id, ownerId));
  if (!user) return false;
  return (
    (await loadEnrollment(db, ownerId, user.generation)) !== null ||
    (await loadRedemption(db, ownerId, user.generation)) !== null
  );
}

export interface PendingRedemption {
  attemptId: string;
  createdAt: Date;
}

export async function loadRedemption(
  db: Db,
  ownerId: string,
  generation: string,
): Promise<PendingRedemption | null> {
  const [row] = await db
    .select({
      attemptId: schema.framebriarRedemptions.attemptId,
      createdAt: schema.framebriarRedemptions.createdAt,
    })
    .from(schema.framebriarRedemptions)
    .where(
      and(
        eq(schema.framebriarRedemptions.ownerId, ownerId),
        eq(schema.framebriarRedemptions.generation, generation),
      ),
    );
  return row ?? null;
}

/**
 * The attempt id for this redemption, written BEFORE the network call. A recent pending attempt is reused, so a lost response
 * retries with the same id; an older one is replaced by a fresh id.
 */
export async function beginRedemption(
  db: Db,
  ownerId: string,
  generation: string,
  now: Date,
  newAttemptId: () => string,
): Promise<string> {
  return whileNotClosing(db, ownerId, async (tx) => {
    const pending = await loadRedemption(tx, ownerId, generation);
    if (pending && now.getTime() - pending.createdAt.getTime() < REDEMPTION_WINDOW_MS) {
      return pending.attemptId;
    }
    const attemptId = newAttemptId();
    await tx
      .insert(schema.framebriarRedemptions)
      .values({ ownerId, generation, attemptId, createdAt: now })
      .onConflictDoUpdate({
        target: schema.framebriarRedemptions.ownerId,
        set: { generation, attemptId, createdAt: now },
      });
    return attemptId;
  });
}

export async function clearRedemption(
  db: Db,
  ownerId: string,
  generation: string,
  attemptId?: string,
): Promise<void> {
  await db
    .delete(schema.framebriarRedemptions)
    .where(
      and(
        eq(schema.framebriarRedemptions.ownerId, ownerId),
        eq(schema.framebriarRedemptions.generation, generation),
        ...(attemptId ? [eq(schema.framebriarRedemptions.attemptId, attemptId)] : []),
      ),
    );
}

/**
 * Commits a successful redemption: the sealed enrollment replaces the one that was seen and the pending attempt is removed, in one
 * transaction. `expectedRevision` is the revision of the row the caller saw (null: there was none): if another writer changed or
 * created it meanwhile, nothing is written and this returns false, so a replace can never overwrite a newer enrollment. The caller
 * reports success only after this returns true.
 */
export async function commitRedemption(
  db: Db,
  input: {
    ownerId: string;
    generation: string;
    attemptId: string;
    keyVersion: string;
    credentials: string;
    expiresAt: Date;
    expectedRevision: number | null;
  },
): Promise<boolean> {
  return whileNotClosing(db, input.ownerId, async (tx) => {
    const sealed = {
      keyVersion: input.keyVersion,
      credentials: input.credentials,
      expiresAt: input.expiresAt,
      state: "active" as const,
    };
    const written =
      input.expectedRevision === null
        ? await tx
            .insert(schema.framebriarEnrollments)
            .values({ ownerId: input.ownerId, generation: input.generation, ...sealed })
            .onConflictDoNothing()
            .returning({ ownerId: schema.framebriarEnrollments.ownerId })
        : await tx
            .update(schema.framebriarEnrollments)
            .set({
              ...sealed,
              revision: sql`${schema.framebriarEnrollments.revision} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.framebriarEnrollments.ownerId, input.ownerId),
                eq(schema.framebriarEnrollments.generation, input.generation),
                eq(schema.framebriarEnrollments.revision, input.expectedRevision),
              ),
            )
            .returning({ ownerId: schema.framebriarEnrollments.ownerId });
    if (written.length === 0) return false;
    await tx
      .delete(schema.framebriarRedemptions)
      .where(
        and(
          eq(schema.framebriarRedemptions.ownerId, input.ownerId),
          eq(schema.framebriarRedemptions.attemptId, input.attemptId),
        ),
      );
    return true;
  });
}
