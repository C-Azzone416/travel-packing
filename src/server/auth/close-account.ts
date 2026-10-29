import "server-only";

import { isAllowed } from "./allowlist";
import {
  beginAccountDeletion,
  completeAccountDeletion,
  reconcileAccountDeletion,
} from "./account-deletion";
import type { RuntimeAuth } from "./auth-runtime";
import type { AuthSession } from "./types";
import type { Db } from "@/server/db/retention";
import { accountHoldsFeedback } from "@/server/feedback/enrollment-store";
import { accountClosureEnabled } from "./account-closure-rollout";

export type CloseAccountOutcome =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "wrong-password" }
  /** The server still holds a Framebriar enrollment or connection attempt for this account (#261). Nothing was authenticated or deleted. */
  | { status: "feedback-blocking" }
  | {
      status: "unavailable";
      deletionStarted: boolean | "unknown";
      /** The provider identity is gone, but removal of the transient database fence was not confirmed. */
      providerDeleted?: true;
    };

/** Read the raw provider session so a fenced partial deletion can be retried without reopening normal app access. */
export async function deletionSession(auth: RuntimeAuth): Promise<AuthSession | null> {
  try {
    const session = await auth.deletionProvider.getSession();
    return session &&
      session.identityCreatedAt !== undefined &&
      isAllowed(auth.allowlist, session.email)
      ? session
      : null;
  } catch {
    return null;
  }
}

/**
 * Close one authenticated account. No identity or owner id comes from the browser. The password sign-in both verifies the
 * current password on the provider and mints a recent session; its returned user id must match the session that opened the
 * flow. Once the database fence commits, retries are idempotent and normal app access remains denied. Confirmed provider
 * deletion is followed by a final owner sweep and removal of the transient fence; only then is closure reported complete.
 */
export async function closeAccount(
  auth: RuntimeAuth,
  db: Db,
  session: AuthSession,
  password: string,
): Promise<CloseAccountOutcome> {
  // The action checks too, but the destructive core must remain safe if another caller reaches it directly.
  if (!accountClosureEnabled()) return { status: "unavailable", deletionStarted: false };

  // The Framebriar gate (#261), before any reauthentication: while sealed feedback credentials or a connection attempt remain, closing
  // is refused (the person is sent back to disconnect). Cheap and read-only; the authoritative check repeats inside the deletion
  // transaction. A fenced retry has no owner row left, so it passes. If the database cannot answer, nothing is attempted.
  try {
    if (await accountHoldsFeedback(db, session.userId)) return { status: "feedback-blocking" };
  } catch {
    return { status: "unavailable", deletionStarted: false };
  }

  const verified = await auth.deletionProvider.signInWithPassword(session.email, password);
  if (!verified.ok) {
    return verified.diagnostic?.reason === "credentials-rejected"
      ? { status: "wrong-password" }
      : { status: "unavailable", deletionStarted: false };
  }
  if (
    verified.session.userId !== session.userId ||
    verified.session.email.trim().toLowerCase() !== session.email.trim().toLowerCase() ||
    session.identityCreatedAt === undefined ||
    verified.session.identityCreatedAt !== session.identityCreatedAt
  ) {
    try {
      await auth.deletionProvider.signOut();
    } catch {
      // The mismatch already fails closed. Never allow cleanup failure to advance deletion for the wrong identity.
    }
    return { status: "unavailable", deletionStarted: false };
  }

  const setupDigest = auth.setup.removalDigest?.(session.email) ?? null;
  if (!setupDigest) return { status: "unavailable", deletionStarted: false };
  try {
    const begun = await beginAccountDeletion(
      db,
      session.userId,
      session.identityCreatedAt,
      setupDigest,
    );
    if (begun === "feedback-blocking") return { status: "feedback-blocking" };
    if (begun === "identity-mismatch") {
      try {
        await auth.deletionProvider.signOut();
      } catch {
        // The mismatch still fails closed.
      }
      return { status: "unavailable", deletionStarted: false };
    }
  } catch {
    // A database may commit and then lose the acknowledgement. Re-read the transient fence before making any claim about
    // whether data was deleted; if that read also fails, preserve the uncertainty for honest recovery copy.
    try {
      const deletionStarted = await auth.setup.isAccountDeletionBlocked?.(session.userId);
      return {
        status: "unavailable",
        deletionStarted: deletionStarted === undefined ? "unknown" : deletionStarted,
      };
    } catch {
      return { status: "unavailable", deletionStarted: "unknown" };
    }
  }

  // Other devices are explicitly revoked first. deleteUser then removes the identity and all remaining sessions,
  // including this request's fresh one, and clears the provider cookie. Either call failing leaves the recovery fence.
  const revoked = await auth.deletionProvider.revokeOtherSessions();
  if (!revoked.ok) return { status: "unavailable", deletionStarted: true };
  const deleted = await auth.deletionProvider.deleteUser(password);
  if (!deleted.ok) {
    const reconciled = await reconcileAccountDeletion(
      db,
      session.userId,
      session.identityCreatedAt,
      setupDigest,
    );
    return reconciled === "completed"
      ? { status: "ok" }
      : { status: "unavailable", deletionStarted: true };
  }
  try {
    const completion = await completeAccountDeletion(
      db,
      session.userId,
      session.identityCreatedAt,
      setupDigest,
    );
    if (completion === "identity-mismatch") {
      return {
        status: "unavailable",
        deletionStarted: "unknown",
        providerDeleted: true,
      };
    }
  } catch {
    // The identity is already gone. A lost commit acknowledgement may mean the fence was removed, so re-read it before
    // withholding completion. Never claim zero retained state while a transient fence is confirmed or cannot be checked.
    const reconciled = await reconcileAccountDeletion(
      db,
      session.userId,
      session.identityCreatedAt,
      setupDigest,
    );
    if (reconciled === "completed") return { status: "ok" };
    try {
      const deletionStarted = await auth.setup.isAccountDeletionBlocked?.(session.userId);
      if (deletionStarted === false) return { status: "ok" };
      return {
        status: "unavailable",
        deletionStarted: deletionStarted === undefined ? "unknown" : deletionStarted,
        providerDeleted: true,
      };
    } catch {
      return { status: "unavailable", deletionStarted: "unknown", providerDeleted: true };
    }
  }
  return { status: "ok" };
}
