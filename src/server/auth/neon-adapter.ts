// Thin adapter from the Neon Auth server SDK (@neondatabase/auth/next/server `createNeonAuth`) to AuthProvider.
// It only maps results; all policy (allowlist, denial, logging) lives in guard.ts.
//
// UNVERIFIED against the live service: no Neon Auth credentials exist in this repo or CI, so the mapping is
// tested against a structural stand-in (NeonAuthLike) and type-checked against the SDK's real types in
// auth-runtime.ts. Enabling it in production is blocked on #27.

import "server-only";
import { logAuthEvent } from "./safe-log";
import type {
  AccountClosureSignInResult,
  AuthProvider,
  AuthSession,
  FlowFailure,
  FlowResult,
  ProviderRejection,
  SignInResult,
} from "./types";

interface NeonUser {
  id?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
  createdAt?: unknown;
}

export interface NeonCallResult {
  data?: unknown;
  error?: { code?: unknown; status?: unknown } | null;
}

export interface NeonDeletionCalls {
  /** A contract-correct session revocation call supplied by the runtime. */
  revokeOtherSessions?: () => Promise<NeonCallResult | null>;
  /** Read the signed session cookie written by the immediately preceding password sign-in. */
  readSessionCookie?: () => Promise<string | undefined>;
  /** Account-closure calls authenticated with that fresh signed cookie. */
  revokeOtherSessionsWithSession?: (sessionCookie: string) => Promise<NeonCallResult | null>;
  deleteUserWithSession?: (
    sessionCookie: string,
    password: string,
  ) => Promise<NeonCallResult | null>;
}

/** The subset of the SDK this adapter uses. */
export interface NeonAuthLike {
  getSession(input?: { query?: { disableCookieCache?: "true" } }): Promise<{
    data?: { user?: NeonUser | null; session?: { createdAt?: unknown } | null } | null;
    error?: unknown;
  } | null>;
  signIn: {
    email(input: { email: string; password: string }): Promise<{
      data?: { user?: NeonUser | null; token?: unknown } | null;
      error?: unknown;
    } | null>;
  };
  requestPasswordReset(input: {
    email: string;
    redirectTo: string;
  }): Promise<NeonCallResult | null>;
  resetPassword(input: { newPassword: string; token: string }): Promise<NeonCallResult | null>;
  signUp: {
    email(input: { email: string; password: string; name: string }): Promise<NeonCallResult | null>;
  };
  emailOtp: {
    sendVerificationOtp(input: {
      email: string;
      type: "email-verification";
    }): Promise<NeonCallResult | null>;
    verifyEmail(input: { email: string; otp: string }): Promise<NeonCallResult | null>;
  };
  signOut(): Promise<NeonCallResult | null>;
  revokeOtherSessions?(): Promise<NeonCallResult | null>;
  deleteUser?(input: { password: string }): Promise<NeonCallResult | null>;
}

/**
 * What a failed provider call means, from its status and code alone (never its message, which may echo input).
 * Network failures, 5xx, and anything without a status are "unavailable"; 429 and attempt-limit codes are
 * "too-many"; password-length codes are "weak-password"; every other client error is "invalid".
 */
function classifyFailure(error: NonNullable<NeonCallResult["error"]>): FlowFailure {
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const status = typeof error.status === "number" ? error.status : 0;
  if (code.includes("TOO_MANY")) return "locked";
  if (status === 429) return "too-many";
  if (code.startsWith("PASSWORD_") || code.includes("PASSWORD_TOO")) return "weak-password";
  if (status === 0 || status >= 500 || code.startsWith("NETWORK") || code === "INTERNAL_ERROR")
    return "unavailable";
  return "invalid";
}

/** The two safe facts about a provider error: its HTTP status (0 when it has none) and its machine code ("" when it has none). */
function rejectionOf(error: NonNullable<NeonCallResult["error"]>): ProviderRejection {
  return {
    status: typeof error.status === "number" ? error.status : 0,
    code: typeof error.code === "string" ? error.code : "",
  };
}

/**
 * Sign-in errors stay generic to the browser, but the provider's status and machine code let operations distinguish a
 * refused credential from a service failure or a session-creation failure. Only facts actually present in the response
 * are classified; unknown client errors remain provider-rejected.
 */
function signInFailure(error: NonNullable<NeonCallResult["error"]>): SignInResult {
  const rejection = rejectionOf(error);
  const code = rejection.code.toUpperCase();
  if (code === "EMAIL_NOT_VERIFIED") {
    return {
      ok: false,
      unverified: true,
      diagnostic: { reason: "email-unverified", rejection },
    };
  }
  if (code === "FAILED_TO_CREATE_SESSION") {
    return { ok: false, diagnostic: { reason: "session-not-created", rejection } };
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD") {
    return { ok: false, diagnostic: { reason: "credentials-rejected", rejection } };
  }
  if (code === "TOO_MANY_ATTEMPTS") {
    return { ok: false, diagnostic: { reason: "provider-rate-limited", rejection } };
  }
  if (code === "INTERNAL_ERROR" || NETWORK_FAILURE_CODES.has(code)) {
    return { ok: false, diagnostic: { reason: "provider-unavailable", rejection } };
  }
  // HTTP classes are useful only where their meaning is unambiguous. A bare or unknown 401 does not prove bad
  // credentials; hosted auth may use it for another rejection, so keep that outcome generic.
  if (rejection.status === 429)
    return { ok: false, diagnostic: { reason: "provider-rate-limited", rejection } };
  if (rejection.status === 0 || rejection.status >= 500)
    return { ok: false, diagnostic: { reason: "provider-unavailable", rejection } };
  return { ok: false, diagnostic: { reason: "provider-rejected", rejection } };
}

const NETWORK_FAILURE_CODES = new Set([
  "NETWORK_ABORT",
  "NETWORK_DNS",
  "NETWORK_ERROR",
  "NETWORK_REFUSED",
  "NETWORK_RESET",
  "NETWORK_TIMEOUT",
  "NETWORK_TLS",
]);

/** Runs one provider call and folds a thrown error into "unavailable"; only the code is logged. */
async function flowCall<Reason extends FlowFailure>(
  call: () => Promise<NeonCallResult | null>,
  onFailure: (reason: FlowFailure, rejection?: ProviderRejection) => FlowResult<Reason>,
): Promise<FlowResult<Reason>> {
  try {
    const result = await call();
    if (result?.error) return onFailure(classifyFailure(result.error), rejectionOf(result.error));
    return result ? { ok: true } : onFailure("unavailable");
  } catch {
    logAuthEvent("provider-error");
    return onFailure("unavailable");
  }
}

/** A refused-because-it-was-wrong reason the step's caller cannot show becomes "invalid" (the safe default). */
function narrow<Reason extends FlowFailure>(
  reason: FlowFailure,
  allowed: readonly Reason[],
  fallback: Reason,
): Reason {
  return (allowed as readonly FlowFailure[]).includes(reason) ? (reason as Reason) : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** The sign-up form asks only for email and password; the provider requires a display name, so use the address's local part. */
const displayName = (email: string) => email.split("@")[0] || "Owner";

/**
 * A user is a session only with an id, an email, and `emailVerified === true`. Fail closed on anything else
 * (false, null, missing): if sign-up is open, anyone could register the owner's address with their own password,
 * and an unverified address proves nothing about who owns it. The allowlist is only meaningful for a verified email.
 */
function toSession(user: NeonUser | null | undefined, created?: unknown): AuthSession | null {
  if (!(user?.id && user.email && user.emailVerified === true)) return null;
  const issuedAt =
    created instanceof Date || typeof created === "string" || typeof created === "number"
      ? new Date(created).getTime()
      : Number.NaN;
  const identityCreatedAt =
    user.createdAt instanceof Date ||
    typeof user.createdAt === "string" ||
    typeof user.createdAt === "number"
      ? new Date(user.createdAt).getTime()
      : Number.NaN;
  return {
    userId: user.id,
    email: user.email,
    ...(Number.isFinite(identityCreatedAt) ? { identityCreatedAt } : {}),
    ...(Number.isFinite(issuedAt) ? { issuedAt } : {}),
  };
}

export function createNeonAuthProvider(
  neon: NeonAuthLike,
  deletionCalls: NeonDeletionCalls = {},
): AuthProvider {
  async function signIn(email: string, password: string): Promise<SignInResult> {
    try {
      const response = await neon.signIn.email({ email, password });
      if (response?.error) return signInFailure(response.error);
      const session = toSession(response?.data?.user);
      if (session) return { ok: true, session };
      // The provider accepted the password but the address is not verified (or it says nothing): no session either way.
      if (response?.data?.user?.id && response.data.user.emailVerified !== true) {
        return {
          ok: false,
          unverified: true,
          diagnostic: { reason: "email-unverified" },
        };
      }
      return { ok: false, diagnostic: { reason: "provider-response-invalid" } };
    } catch {
      // Nothing from the thrown value is logged: it may contain an address, password or provider response body.
      return { ok: false, diagnostic: { reason: "provider-unavailable" } };
    }
  }

  const revoke = async (
    call: (() => Promise<NeonCallResult | null>) | undefined,
  ): Promise<FlowResult<"unavailable">> => {
    try {
      const result = await (call?.() ?? Promise.resolve(null));
      return !result?.error && record(result?.data)?.status === true
        ? { ok: true }
        : { ok: false, reason: "unavailable" };
    } catch {
      logAuthEvent("provider-error");
      return { ok: false, reason: "unavailable" };
    }
  };

  const removeIdentity = async (
    call: (() => Promise<NeonCallResult | null>) | undefined,
  ): Promise<FlowResult<"invalid" | "unavailable">> => {
    try {
      const result = await (call?.() ?? Promise.resolve(null));
      if (result?.error) {
        return {
          ok: false,
          reason: classifyFailure(result.error) === "unavailable" ? "unavailable" : "invalid",
        };
      }
      const data = record(result?.data);
      // Better Auth can answer successfully after merely sending a verification email. Only this response confirms that
      // the installed endpoint actually removed the identity and sessions; every other 2xx stays fenced and retryable.
      return data?.success === true && data.message === "User deleted"
        ? { ok: true }
        : { ok: false, reason: "unavailable" };
    } catch {
      logAuthEvent("provider-error");
      return { ok: false, reason: "unavailable" };
    }
  };

  return {
    async getSession() {
      // Neon Auth caches signed session data in a browser cookie for five minutes by default. A revoked session can
      // otherwise continue authorizing requests until that cache expires. The installed server wrapper checks the
      // pre-serialization query value as the string "true", then forwards it to Better Auth's authoritative session read.
      const result = await neon.getSession({ query: { disableCookieCache: "true" } });
      return result?.error ? null : toSession(result?.data?.user, result?.data?.session?.createdAt);
    },
    async signInWithPassword(email, password): Promise<SignInResult> {
      return signIn(email, password);
    },
    async beginAccountClosure(email, password): Promise<AccountClosureSignInResult> {
      const readSessionCookie = deletionCalls.readSessionCookie;
      let previousSessionCookie: string | undefined;
      try {
        previousSessionCookie = await readSessionCookie?.();
      } catch {
        return { ok: false, diagnostic: { reason: "provider-unavailable" } };
      }
      const signedIn = await signIn(email, password);
      if (!signedIn.ok) return signedIn;
      let freshSessionCookie: string | undefined;
      try {
        freshSessionCookie = await readSessionCookie?.();
      } catch {
        return { ok: false, diagnostic: { reason: "provider-unavailable" } };
      }
      // Better Auth returns the raw token in JSON but authenticates cookies with the signed value it writes in
      // Set-Cookie. Require that write to be observable and different from the incoming session; never synthesize a
      // cookie from response data or silently fall back to the ambient request credential.
      if (!freshSessionCookie || freshSessionCookie === previousSessionCookie) {
        return { ok: false, diagnostic: { reason: "session-not-created" } };
      }
      const revokeWithSession = deletionCalls.revokeOtherSessionsWithSession;
      const deleteWithSession = deletionCalls.deleteUserWithSession;
      return {
        ok: true,
        authorization: {
          session: signedIn.session,
          revokeOtherSessions: () =>
            revoke(revokeWithSession ? () => revokeWithSession(freshSessionCookie) : undefined),
          deleteUser: (closurePassword) =>
            removeIdentity(
              deleteWithSession
                ? () => deleteWithSession(freshSessionCookie, closurePassword)
                : undefined,
            ),
        },
      };
    },
    async signUp(email, password) {
      return flowCall(
        () => neon.signUp.email({ email, password, name: displayName(email) }),
        (reason, rejection): FlowResult<"weak-password" | "unavailable"> =>
          // A taken address (and any other client error) must look exactly like a new account: the verification step
          // follows either way, so the screen never says which addresses are registered. The rejection (status and code)
          // rides along only so the SERVER can log that the provider refused the call.
          reason === "weak-password" || reason === "unavailable"
            ? { ok: false, reason }
            : { ok: true, ...(rejection ? { rejected: rejection } : {}) },
      );
    },
    async verifyEmail(email, otp) {
      return flowCall(
        () => neon.emailOtp.verifyEmail({ email, otp }),
        (reason) => ({
          ok: false,
          reason: narrow(
            reason,
            ["invalid", "locked", "too-many", "unavailable"] as const,
            "invalid",
          ),
        }),
      );
    },
    async resendVerificationCode(email) {
      return sendOnly(() =>
        neon.emailOtp.sendVerificationOtp({ email, type: "email-verification" }),
      );
    },
    async requestPasswordReset(email, redirectTo) {
      return sendOnly(() => neon.requestPasswordReset({ email, redirectTo }));
    },
    async resetPassword(token, newPassword) {
      return flowCall(
        () => neon.resetPassword({ token, newPassword }),
        (reason) => ({
          ok: false,
          // A token that is wrong, expired or used is one "invalid"; "locked" has no meaning for a token.
          reason: narrow(reason, ["weak-password", "too-many", "unavailable"] as const, "invalid"),
        }),
      );
    },
    async signOut() {
      try {
        const result = await neon.signOut();
        // The server SDK resolves HTTP/transport failures as { data: null, error }; throwing here lets callers observe that
        // cleanup was not confirmed.
        if (!result || result.error) throw new Error("unconfirmed");
      } catch {
        // Never surface the provider's thrown value or resolved error message; either may contain request details.
        throw new Error("Auth provider sign-out failed");
      }
    },
    async revokeOtherSessions() {
      const call = deletionCalls.revokeOtherSessions ?? neon.revokeOtherSessions;
      return revoke(call ? () => call() : undefined);
    },
    async deleteUser(password) {
      const call = neon.deleteUser;
      return removeIdentity(call ? () => call({ password }) : undefined);
    },
    async isAccountDeletionBlocked() {
      return false;
    },
  };
}

/** Asking for a code or link reports success for every address the provider accepts; only limits and outages are shown. */
function sendOnly(
  call: () => Promise<NeonCallResult | null>,
): Promise<FlowResult<"too-many" | "unavailable">> {
  return flowCall(call, (reason, rejection): FlowResult<"too-many" | "unavailable"> =>
    reason === "too-many" || reason === "unavailable"
      ? { ok: false, reason }
      : { ok: true, ...(rejection ? { rejected: rejection } : {}) },
  );
}
