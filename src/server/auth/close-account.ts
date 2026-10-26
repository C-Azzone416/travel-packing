import "server-only";

import { isAllowed } from "./allowlist";
import { beginAccountDeletion } from "./account-deletion";
import type { RuntimeAuth } from "./auth-runtime";
import type { AuthSession } from "./types";
import type { Db } from "@/server/db/retention";

export type CloseAccountOutcome =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "wrong-password" }
  | { status: "unavailable"; deletionStarted: boolean | "unknown" };

/** Read the raw provider session so a fenced partial deletion can be retried without reopening normal app access. */
export async function deletionSession(auth: RuntimeAuth): Promise<AuthSession | null> {
  try {
    const session = await auth.deletionProvider.getSession();
    return session && isAllowed(auth.allowlist, session.email) ? session : null;
  } catch {
    return null;
  }
}

/**
 * Close one authenticated account. No identity or owner id comes from the browser. The password sign-in both verifies the
 * current password on the provider and mints a recent session; its returned user id must match the session that opened the
 * flow. Once the database fence commits, retries are idempotent and normal app access remains denied.
 */
export async function closeAccount(
  auth: RuntimeAuth,
  db: Db,
  session: AuthSession,
  password: string,
): Promise<CloseAccountOutcome> {
  const verified = await auth.deletionProvider.signInWithPassword(session.email, password);
  if (!verified.ok) {
    return verified.diagnostic?.reason === "credentials-rejected"
      ? { status: "wrong-password" }
      : { status: "unavailable", deletionStarted: false };
  }
  if (
    verified.session.userId !== session.userId ||
    verified.session.email.trim().toLowerCase() !== session.email.trim().toLowerCase()
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
    await beginAccountDeletion(db, session.userId, setupDigest);
  } catch {
    // A database may commit and then lose the acknowledgement. Re-read the durable fence before making any claim about
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
  // including this request's fresh one, and clears the provider cookie. Either call failing leaves the durable fence.
  const revoked = await auth.deletionProvider.revokeOtherSessions();
  if (!revoked.ok) return { status: "unavailable", deletionStarted: true };
  const deleted = await auth.deletionProvider.deleteUser(password);
  if (!deleted.ok) return { status: "unavailable", deletionStarted: true };
  return { status: "ok" };
}
