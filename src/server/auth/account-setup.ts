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
// no raw addresses). It is only ever added, never removed.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/retention";
import { accountSetups } from "@/server/db/schema";
import { normalizeEmail } from "./allowlist";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider } from "./types";

export interface AccountSetupStore {
  isComplete(email: string): Promise<boolean>;
  /** Records that this address's password was set through an emailed link. Safe to repeat. */
  markComplete(email: string): Promise<void>;
}

export const emailDigest = (email: string) =>
  createHash("sha256").update(normalizeEmail(email)).digest("hex");

export function createDbSetupStore(db: Db): AccountSetupStore {
  return {
    async isComplete(email) {
      const rows = await db
        .select({ digest: accountSetups.emailDigest })
        .from(accountSetups)
        .where(eq(accountSetups.emailDigest, emailDigest(email)))
        .limit(1);
      return rows.length > 0;
    },
    async markComplete(email) {
      await db
        .insert(accountSetups)
        .values({ emailDigest: emailDigest(email) })
        .onConflictDoNothing();
    },
  };
}

/** For tests: an in-memory store, optionally starting with some addresses already set up. */
export function createMemorySetupStore(complete: string[] = []): AccountSetupStore & {
  digests: Set<string>;
} {
  const digests = new Set(complete.map(emailDigest));
  return {
    digests,
    async isComplete(email) {
      return digests.has(emailDigest(email));
    },
    async markComplete(email) {
      digests.add(emailDigest(email));
    },
  };
}

/** The store used when no database exists: nothing is ever set up, so nobody can sign in. */
export const NOTHING_SET_UP: AccountSetupStore = {
  async isComplete() {
    return false;
  },
  async markComplete() {},
};

/**
 * Wraps a provider so a session only exists for an account that has been set up. Fails closed: a store error is "not set up".
 * "Set up" is permanent, so a positive answer is remembered for the life of the process (one lookup per address, not one
 * per request).
 */
export function withSetupGate(provider: AuthProvider, store: AccountSetupStore): AuthProvider {
  const known = new Set<string>();
  async function isSetUp(email: string): Promise<boolean> {
    const key = normalizeEmail(email);
    if (known.has(key)) return true;
    try {
      if (!(await store.isComplete(email))) return false;
    } catch {
      logAuthEvent("provider-error");
      return false;
    }
    known.add(key);
    return true;
  }
  return {
    ...provider,
    async getSession() {
      const session = await provider.getSession();
      return session && (await isSetUp(session.email)) ? session : null;
    },
    async signInWithPassword(email, password) {
      const result = await provider.signInWithPassword(email, password);
      if (!result.ok || (await isSetUp(result.session.email))) return result;
      // Right password, verified address, but never set up through a link: no session, and nothing says why beyond "finish".
      logAuthEvent("sign-in-setup-pending");
      try {
        await provider.signOut();
      } catch {
        logAuthEvent("provider-error");
      }
      return { ok: false, unfinished: true };
    },
  };
}
