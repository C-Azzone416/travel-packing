// Sign-in service used by the sign-in server action. Kept separate from Next.js so it can be tested directly.

import { isAllowed, type Allowlist } from "./allowlist";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider } from "./types";

/**
 * - invalid: bad credentials or missing fields (the UI shows one generic message)
 * - denied: valid account that is not on the allowlist; the session is ended before returning
 * - ok: allowlisted owner, session established
 */
export type SignInOutcome = "ok" | "invalid" | "denied";

export async function signInOwner(
  auth: { provider: AuthProvider; allowlist: Allowlist },
  email: unknown,
  password: unknown,
): Promise<SignInOutcome> {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    logAuthEvent("sign-in-failed");
    return "invalid";
  }
  const result = await auth.provider.signInWithPassword(email.trim(), password);
  if (!result.ok) {
    logAuthEvent("sign-in-failed");
    return "invalid";
  }
  if (!isAllowed(auth.allowlist, result.session.email)) {
    logAuthEvent("sign-in-denied");
    try {
      await auth.provider.signOut();
    } catch {
      logAuthEvent("provider-error");
    }
    return "denied";
  }
  logAuthEvent("sign-in-succeeded");
  return "ok";
}

export async function signOutOwner(provider: AuthProvider): Promise<void> {
  try {
    await provider.signOut();
  } catch {
    logAuthEvent("provider-error");
  }
  logAuthEvent("sign-out");
}
