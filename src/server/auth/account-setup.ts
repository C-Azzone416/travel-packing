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
import type { AuthProvider } from "./types";

export interface AccountSetupStore {
  /** When this address's password was set through an emailed link (ms since the epoch), or null if it never was. */
  completedAt(email: string): Promise<number | null>;
  /** Records that this address's password was set through an emailed link. Safe to repeat. */
  markComplete(email: string): Promise<void>;
  /**
   * The opaque database key to remove with an account. Null means this store has no durable row. Keeping the digest
   * calculation here prevents deletion code from reaching for the auth cookie secret.
   */
  removalDigest?(email: string): string | null;
  /** Whether deletion has begun for this opaque provider user id. Errors are allowed to fail the caller closed. */
  isAccountDeletionBlocked?(userId: string): Promise<boolean>;
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
    removalDigest(email) {
      return digest(email);
    },
    async isAccountDeletionBlocked(userId) {
      return blockedUserIds.has(userId);
    },
  };
}

/** The store used when no database exists: nothing is ever set up, so nobody can sign in. */
export const NOTHING_SET_UP: AccountSetupStore = {
  async completedAt() {
    return null;
  },
  async markComplete() {},
  removalDigest() {
    return null;
  },
  async isAccountDeletionBlocked() {
    return true;
  },
};

/**
 * Wraps a provider so a session only exists for an allowlisted account that has been set up. Fails closed: a store error is "not set up".
 * "Set up" is permanent, so a positive answer is remembered for the life of the process (one lookup per address, not one
 * per request).
 */
export function withSetupGate(
  provider: AuthProvider,
  store: AccountSetupStore,
  allowlist: Allowlist,
): AuthProvider {
  // Include the provider identity. A deleted address may register again with a new provider user id; that new identity must
  // not inherit the old identity's in-process positive setup result after the durable setup digest has been removed.
  const known = new Map<string, number>();
  type SetupState =
    { status: "complete"; at: number } | { status: "pending" } | { status: "unavailable" };
  /** Whether the account was set up (0 = no requirement), still pending, or could not be checked. */
  async function setupState(email: string, userId: string): Promise<SetupState> {
    // An address that is not allowlisted never gets in whatever its setup says; leave it to the allowlist's own denial (the
    // access-denied screen and the signed-out session), exactly as before this gate existed.
    if (!isAllowed(allowlist, email)) return { status: "complete", at: 0 };
    const key = `${normalizeEmail(email)}\u0000${userId}`;
    const cached = known.get(key);
    if (cached !== undefined) return { status: "complete", at: cached };
    let at: number | null;
    try {
      at = await store.completedAt(email);
    } catch {
      return { status: "unavailable" };
    }
    if (at !== null) known.set(key, at);
    return at === null ? { status: "pending" } : { status: "complete", at };
  }
  async function deletionBlocked(userId: string): Promise<"blocked" | "clear" | "unavailable"> {
    try {
      return (await store.isAccountDeletionBlocked?.(userId)) ? "blocked" : "clear";
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
      if ((await deletionBlocked(session.userId)) !== "clear") return null;
      const setup = await setupState(session.email, session.userId);
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
      const deletion = await deletionBlocked(result.session.userId);
      // A confirmed fence deliberately leaves the newly minted raw-provider session alive. The sign-in action sends it to
      // the isolated recovery screen, which can retry identity/session deletion without restoring any app access or data.
      if (deletion === "blocked") {
        return {
          ok: false,
          deletionPending: true,
          diagnostic: { reason: "account-deletion-pending" },
        };
      }
      const setup = await setupState(result.session.email, result.session.userId);
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
