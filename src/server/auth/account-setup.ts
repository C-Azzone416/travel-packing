// "Has this account's password been set through an emailed link?" (#83)
//
// The gap this closes: anyone who knows the owner's email could sign up with it first, with their own password. The account
// stays unverified, so it cannot sign in, but when the real owner later enters the mailed code it becomes verified WITH THE
// OTHER PERSON'S PASSWORD. So a verified account is not enough: the app also requires a record that the password was set
// through a link only the inbox owner receives (the sign-up "finish setting up" link, or any forgot-password link). Without
// that record there is no session, however the sign-in is reached (this wraps the provider, so the proxy, the data layer and
// server actions all see it, including a session cookie minted by calling the auth service directly).
//
// The record is a SHA-256 digest of the normalized email (there is no user id before the first session, and the app keeps
// no raw addresses). It is removed only as part of the account-deletion transaction.

import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/retention";
import { accountDeletions, accountSetups } from "@/server/db/schema";
import { isAllowed, normalizeEmail, type Allowlist } from "./allowlist";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider, AuthSession, FlowResult } from "./types";
import { lockAccountDeletion, lockAccountSetup } from "./account-deletion-lock";

type PasswordResetResult = FlowResult<"weak-password" | "invalid" | "too-many" | "unavailable">;

export interface AccountSetupStore {
  /** When this address's password was set through an emailed link (ms since the epoch), or null if it never was. */
  completedAt(email: string): Promise<number | null>;
  /** Records that this address's password was set through an emailed link. Safe to repeat. */
  markComplete(email: string): Promise<void>;
  /**
   * Holds the same opaque-email lock used by deletion while the provider consumes a reset token and the setup row is
   * recorded. This closes the only interval in which confirmed deletion could otherwise be followed by a late setup row.
   */
  resetPasswordAndMarkComplete(
    email: string,
    reset: () => Promise<PasswordResetResult>,
  ): Promise<PasswordResetResult>;
  /**
   * The opaque database key to remove with an account. Null means this store has no durable row. Keeping the digest
   * calculation here prevents deletion code from reaching for the auth cookie secret.
   */
  removalDigest?(email: string): string | null;
  /** Whether deletion has begun for this opaque provider user id. Errors are allowed to fail the caller closed. */
  isAccountDeletionBlocked?(userId: string): Promise<boolean>;
  /** Reconcile a transient fence against the provider identity incarnation on an authoritative session. */
  deletionState?(session: AuthSession): Promise<"clear" | "pending">;
}

/** The HMAC key for digests, derived from the app secret with a fixed label so the secret itself is never used directly. */
export const setupDigestKey = (secret: string) =>
  createHmac("sha256", secret).update("carrywell:account-setup-digest:v1").digest("hex");

export const emailDigest = (email: string, key: string) =>
  createHmac("sha256", key).update(normalizeEmail(email)).digest("hex");

export function createDbSetupStore(db: Db, key: string): AccountSetupStore {
  return {
    async completedAt(email) {
      const rows = await db
        .select({ at: accountSetups.completedAt })
        .from(accountSetups)
        .where(eq(accountSetups.emailDigest, emailDigest(email, key)))
        .limit(1);
      return rows.length > 0 ? rows[0].at.getTime() : null;
    },
    async markComplete(email) {
      await db
        .insert(accountSetups)
        .values({ emailDigest: emailDigest(email, key) })
        .onConflictDoNothing();
    },
    async resetPasswordAndMarkComplete(email, reset) {
      const digest = emailDigest(email, key);
      return db.transaction(async (transaction) => {
        await lockAccountSetup(transaction, digest);
        const result = await reset();
        if (result.ok) {
          await transaction
            .insert(accountSetups)
            .values({ emailDigest: digest })
            .onConflictDoNothing();
        }
        return result;
      });
    },
    removalDigest(email) {
      return emailDigest(email, key);
    },
    async isAccountDeletionBlocked(userId) {
      const rows = await db
        .select({ userId: accountDeletions.userId })
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, userId))
        .limit(1);
      return rows.length > 0;
    },
    async deletionState(session) {
      if (session.identityCreatedAt === undefined)
        throw new Error("provider identity generation missing");
      // The ordinary case has no fence. Avoid opening a transaction (and taking an advisory lock) for every session read:
      // Next can evaluate several server components concurrently, while the PGlite e2e backend has one transactional
      // connection. Serializing every harmless read there eventually starves unrelated requests. `authorizeOwner` performs
      // a second fence read before returning `ok`, and every owner-data mutation takes this same lock and re-reads the
      // fence, so a deletion that begins after this fast read still cannot recreate owner data.
      const existing = await db
        .select({ userId: accountDeletions.userId })
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, session.userId))
        .limit(1);
      if (existing.length === 0) return "clear";

      // A present fence needs the serialized path: it may belong to this identity (blocked), or to an older provider
      // identity whose setup proof must be removed before the fence is cleared.
      return db.transaction(async (transaction) => {
        await lockAccountDeletion(transaction, session.userId);
        const rows = await transaction
          .select({
            identityCreatedAt: accountDeletions.identityCreatedAt,
            setupEmailDigest: accountDeletions.setupEmailDigest,
          })
          .from(accountDeletions)
          .where(eq(accountDeletions.userId, session.userId))
          .limit(1);
        if (rows.length === 0) return "clear";
        if (rows[0].identityCreatedAt.getTime() === session.identityCreatedAt) return "pending";
        // The provider reused an id for a different identity. App requests remained fenced by user id, so no new owner
        // data can exist yet. Remove the old setup proof under the same lock used by password-reset completion before
        // clearing the obsolete marker, so the replacement identity must complete its own inbox-owned setup flow.
        await lockAccountSetup(transaction, rows[0].setupEmailDigest);
        await transaction
          .delete(accountSetups)
          .where(eq(accountSetups.emailDigest, rows[0].setupEmailDigest));
        await transaction
          .delete(accountDeletions)
          .where(eq(accountDeletions.userId, session.userId));
        return "clear";
      });
    },
  };
}

/** For tests: an in-memory store, optionally starting with some addresses already set up (at time 0, so any session counts). */
export const TEST_DIGEST_KEY = "test-digest-key";
export function createMemorySetupStore(
  complete: string[] = [],
  now: () => number = Date.now,
): AccountSetupStore & { digests: Map<string, number>; blockedUserIds: Set<string> } {
  const digest = (email: string) => emailDigest(email, TEST_DIGEST_KEY);
  const digests = new Map<string, number>(complete.map((email) => [digest(email), 0]));
  const blockedUserIds = new Set<string>();
  return {
    digests,
    blockedUserIds,
    async completedAt(email) {
      return digests.get(digest(email)) ?? null;
    },
    async markComplete(email) {
      if (!digests.has(digest(email))) digests.set(digest(email), now());
    },
    async resetPasswordAndMarkComplete(email, reset) {
      const result = await reset();
      if (result.ok && !digests.has(digest(email))) digests.set(digest(email), now());
      return result;
    },
    removalDigest(email) {
      return digest(email);
    },
    async isAccountDeletionBlocked(userId) {
      return blockedUserIds.has(userId);
    },
    async deletionState(session) {
      return blockedUserIds.has(session.userId) ? "pending" : "clear";
    },
  };
}

/** The store used when no database exists: nothing is ever set up, so nobody can sign in. */
export const NOTHING_SET_UP: AccountSetupStore = {
  async completedAt() {
    return null;
  },
  async markComplete() {},
  async resetPasswordAndMarkComplete(_email, reset) {
    return reset();
  },
  removalDigest() {
    return null;
  },
  async isAccountDeletionBlocked() {
    return true;
  },
  async deletionState() {
    return "pending";
  },
};

/**
 * Wraps a provider so a session only exists for an allowlisted account that has been set up. Fails closed: a store error is "not set up".
 * The setup record is re-read for every authorization. Account closure removes it, and a later provider identity must never
 * inherit an in-process positive result even if the provider were to reuse the same user id.
 */
export function withSetupGate(
  provider: AuthProvider,
  store: AccountSetupStore,
  allowlist: Allowlist,
): AuthProvider {
  type SetupState =
    { status: "complete"; at: number } | { status: "pending" } | { status: "unavailable" };
  /** Whether the account was set up (0 = no requirement), still pending, or could not be checked. */
  async function setupState(email: string): Promise<SetupState> {
    // An address that is not allowlisted never gets in whatever its setup says; leave it to the allowlist's own denial (the
    // access-denied screen and the signed-out session), exactly as before this gate existed.
    if (!isAllowed(allowlist, email)) return { status: "complete", at: 0 };
    let at: number | null;
    try {
      at = await store.completedAt(email);
    } catch {
      return { status: "unavailable" };
    }
    return at === null ? { status: "pending" } : { status: "complete", at };
  }
  async function deletionBlocked(
    session: AuthSession,
  ): Promise<"blocked" | "clear" | "unavailable"> {
    try {
      if (store.deletionState)
        return (await store.deletionState(session)) === "pending" ? "blocked" : "clear";
      return (await store.isAccountDeletionBlocked?.(session.userId)) ? "blocked" : "clear";
    } catch {
      return "unavailable";
    }
  }
  return {
    ...provider,
    isAccountDeletionBlocked(userId) {
      return store.isAccountDeletionBlocked?.(userId) ?? provider.isAccountDeletionBlocked(userId);
    },
    async getSession() {
      const session = await provider.getSession();
      if (!session) return null;
      if ((await deletionBlocked(session)) !== "clear") return null;
      const setup = await setupState(session.email);
      if (setup.status === "unavailable") {
        // There is no request-scoped sign-in reference on ordinary session reads; retain the closed legacy event here.
        logAuthEvent("provider-error");
        return null;
      }
      if (setup.status === "pending") return null;
      // A session made at or before the moment the password was set through the link may have been opened with a password
      // chosen by someone else (pre-registration): it stays refused after the link is used. One that does not say when it was
      // made is refused too.
      if (setup.at > 0 && !(session.issuedAt !== undefined && session.issuedAt > setup.at))
        return null;
      return session;
    },
    async signInWithPassword(email, password) {
      const result = await provider.signInWithPassword(email, password);
      // A session made by this very call is newer than any setup, so only "was it ever set up" matters here.
      if (!result.ok) return result;
      const deletion = await deletionBlocked(result.session);
      // A confirmed fence deliberately leaves the newly minted raw-provider session alive. The sign-in action sends it to
      // the isolated recovery screen, which can retry identity/session deletion without restoring any app access or data.
      if (deletion === "blocked") {
        return {
          ok: false,
          deletionPending: true,
          diagnostic: { reason: "account-deletion-pending" },
        };
      }
      const setup = await setupState(result.session.email);
      if (deletion === "clear" && setup.status === "complete") return result;
      // Right password, verified address, but never set up through a link: no session, and nothing says why beyond "finish".
      let cleanupFailed = false;
      try {
        await provider.signOut();
      } catch {
        cleanupFailed = true;
      }
      return {
        ok: false,
        unfinished: true,
        diagnostic: {
          reason:
            deletion === "unavailable"
              ? "setup-unavailable"
              : setup.status === "pending"
                ? "setup-pending"
                : "setup-unavailable",
          ...(cleanupFailed ? { cleanupFailed: true } : {}),
        },
      };
    },
  };
}
