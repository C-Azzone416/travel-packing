// Database access for the Framebriar enrollment (#259). Rows hold only sealed credentials plus plain metadata (deadline, state).
// Every write that changes an enrollment names the revision it read and loses cleanly if another instance wrote first, so two
// phones, two server instances or a refresh racing a disconnect cannot corrupt the credential state.

import { and, eq, sql } from "drizzle-orm";
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

/** How long a started redemption can be retried with the same attempt id before a new attempt starts. */
export const REDEMPTION_WINDOW_MS = 15 * 60 * 1000;

/** The account's generation, provisioning the app user row first (a recreated account gets a new, never-reused one). */
export async function accountGeneration(db: Db, ownerId: string): Promise<string> {
  await db.insert(schema.users).values({ id: ownerId }).onConflictDoNothing();
  const [row] = await db
    .select({ generation: schema.users.generation })
    .from(schema.users)
    .where(eq(schema.users.id, ownerId));
  if (!row) throw new Error("account row missing");
  return row.generation;
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
  const updated = await db
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
  const pending = await loadRedemption(db, ownerId, generation);
  if (pending && now.getTime() - pending.createdAt.getTime() < REDEMPTION_WINDOW_MS) {
    return pending.attemptId;
  }
  const attemptId = newAttemptId();
  await db
    .insert(schema.framebriarRedemptions)
    .values({ ownerId, generation, attemptId, createdAt: now })
    .onConflictDoUpdate({
      target: schema.framebriarRedemptions.ownerId,
      set: { generation, attemptId, createdAt: now },
    });
  return attemptId;
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
  return db.transaction(async (tx) => {
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
