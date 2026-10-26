// Sign-in service used by the sign-in server action. Kept separate from Next.js so it can be tested directly.

import { cleanEmail } from "./account-flows";
import { isAllowed, type Allowlist } from "./allowlist";
import { logAuthEvent, type AuthEvent } from "./safe-log";
import type { AuthProvider, ProviderRejection, SignInDiagnostic } from "./types";

/**
 * - invalid: bad credentials or missing fields (the UI shows one generic message)
 * - denied: valid account that is not on the allowlist; the session is ended before returning
 * - unverified: the password was right but the address is not verified yet; the caller sends a new code. No session exists.
 * - unfinished: the password was right and the address verified, but the password was never set through an emailed link
 *   (#83); the caller sends that link. No session exists.
 * - deletion-pending: credentials were verified for a fenced identity; only the isolated deletion retry may use its session.
 * - ok: allowlisted owner, session established
 */
export type SignInOutcome =
  "ok" | "invalid" | "denied" | "unverified" | "unfinished" | "deletion-pending";

export async function signInOwner(
  auth: { provider: AuthProvider; allowlist: Allowlist },
  email: unknown,
  password: unknown,
  reference?: string,
): Promise<SignInOutcome> {
  const log = (event: AuthEvent, rejection?: ProviderRejection) =>
    logAuthEvent(event, { ...rejection, reference });
  const normalizedEmail = cleanEmail(email);
  if (!normalizedEmail || typeof password !== "string" || !password) {
    log("sign-in-input-invalid");
    return "invalid";
  }
  const result = await auth.provider.signInWithPassword(normalizedEmail, password);
  if (!result.ok) {
    if (result.deletionPending) {
      log("sign-in-failed");
      return "deletion-pending";
    }
    if (result.unfinished) {
      log(
        result.diagnostic?.reason === "setup-unavailable"
          ? "sign-in-setup-unavailable"
          : "sign-in-setup-pending",
        result.diagnostic?.rejection,
      );
      if (result.diagnostic?.cleanupFailed) log("sign-in-session-cleanup-failed");
      return "unfinished";
    }
    if (result.unverified) {
      log("sign-in-unverified", result.diagnostic?.rejection);
      return "unverified";
    }
    log(signInFailureEvent(result.diagnostic), result.diagnostic?.rejection);
    return "invalid";
  }
  if (!isAllowed(auth.allowlist, result.session.email)) {
    log("sign-in-denied");
    try {
      await auth.provider.signOut();
    } catch {
      log("sign-in-session-cleanup-failed");
    }
    return "denied";
  }
  log("sign-in-succeeded");
  return "ok";
}

function signInFailureEvent(diagnostic: SignInDiagnostic | undefined): AuthEvent {
  switch (diagnostic?.reason) {
    case "credentials-rejected":
      return "sign-in-credentials-rejected";
    case "provider-rate-limited":
      return "sign-in-provider-rate-limited";
    case "provider-unavailable":
      return "sign-in-provider-unavailable";
    case "provider-response-invalid":
      return "sign-in-provider-response-invalid";
    case "session-not-created":
      return "sign-in-session-not-created";
    case "provider-rejected":
      return "sign-in-provider-rejected";
    default:
      // Providers other than Neon may not yet supply diagnostics; retain a bounded fallback.
      return "sign-in-failed";
  }
}

export async function signOutOwner(provider: AuthProvider): Promise<void> {
  try {
    await provider.signOut();
  } catch {
    logAuthEvent("provider-error");
  }
  logAuthEvent("sign-out");
}
