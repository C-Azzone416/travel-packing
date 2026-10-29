// Auth contract the app depends on. The managed provider (Neon Auth / Better Auth) sits behind it, so unit
// tests use a fake and make no network calls. Ordinary calls use the ambient Next.js request context. Account closure
// instead carries a server-only opaque capability so its destructive calls remain bound to the fresh reauthentication.

export interface AuthSession {
  userId: string;
  email: string;
  /** When the provider identity was created (ms since epoch). Binds destructive recovery to one identity incarnation. */
  identityCreatedAt?: number;
  /**
   * When the provider created this session (ms since the epoch), if it says. The setup gate (#83) refuses a session made
   * before the account's password was set through a link, so one minted with a pre-registered password stays dead.
   */
  issuedAt?: number;
}

/**
 * A bounded explanation of a failed password sign-in. It is server-only diagnostic data: callers keep the public response
 * generic, while safe logs may record the reason and a sanitized provider status/code.
 */
export type SignInFailureReason =
  | "credentials-rejected"
  | "email-unverified"
  | "provider-rate-limited"
  | "provider-unavailable"
  | "provider-rejected"
  | "provider-response-invalid"
  | "session-not-created"
  | "account-deletion-pending"
  | "setup-pending"
  | "setup-unavailable";

export interface SignInDiagnostic {
  reason: SignInFailureReason;
  rejection?: ProviderRejection;
  /** The app tried to end a session it must not keep, but the provider's sign-out call failed. */
  cleanupFailed?: true;
}

/**
 * `unverified` means the password was RIGHT but the address is not verified yet. It is only ever reported after the
 * password matched, so it tells a caller nothing about accounts they cannot already sign in to.
 * `unfinished` is the same for a verified address whose password was never set through an emailed link (#83): no session.
 */
export type SignInResult =
  | { ok: true; session: AuthSession }
  | {
      ok: false;
      unverified?: true;
      unfinished?: true;
      /** The password was right, but this identity is fenced while provider deletion is retried. */
      deletionPending?: true;
      diagnostic?: SignInDiagnostic;
    };

/**
 * A server-only, short-lived capability created by password reauthentication for account closure. Its methods are bound
 * to the session minted by that exact sign-in, so destructive provider calls cannot accidentally fall back to the older
 * cookie on the incoming request. Implementations must not expose or serialize the underlying provider credential.
 */
export interface AccountClosureAuthorization {
  session: AuthSession;
  revokeOtherSessions(): Promise<FlowResult<"unavailable">>;
  deleteUser(password: string): Promise<FlowResult<"invalid" | "unavailable">>;
}

export type AccountClosureSignInResult =
  { ok: true; authorization: AccountClosureAuthorization } | Exclude<SignInResult, { ok: true }>;

/**
 * Why a sign-up, code, or reset step failed, in terms the UI may show. Deliberately small: nothing here says whether an
 * address has an account (a taken address looks like a success, a wrong code and an unknown address look the same).
 * - weak-password: the provider refused the password (too short, too long)
 * - invalid: the code or link is wrong, expired, already used, or missing (one message, one way out: ask for a new one)
 * - locked: too many wrong codes; the provider has voided the code and a new one is needed
 * - too-many: the provider is rate limiting this person
 * - unavailable: network or provider failure; safe to try again
 */
export type FlowFailure = "weak-password" | "invalid" | "locked" | "too-many" | "unavailable";

/**
 * A provider call that answered with a client error (a 4xx) which the screens deliberately treat as success, so an address's
 * state is never revealed. Kept only so the server can log WHAT happened (status and machine code, never a message).
 */
export interface ProviderRejection {
  status: number;
  code: string;
}

export type FlowResult<Reason extends FlowFailure = FlowFailure> =
  { ok: true; rejected?: ProviderRejection } | { ok: false; reason: Reason };

export interface AuthProvider {
  /** The current request's session, or null when signed out. */
  getSession(): Promise<AuthSession | null>;
  /** Email + password sign-in. A failure never says which part was wrong. */
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  /** Reauthenticate and bind the whole account-closure sequence to the newly minted provider session. */
  beginAccountClosure(email: string, password: string): Promise<AccountClosureSignInResult>;
  /**
   * Create an UNVERIFIED account and send it a verification code. A taken address is reported as success (the
   * provider sends nothing), so the result never reveals whether an address is already registered.
   */
  signUp(email: string, password: string): Promise<FlowResult<"weak-password" | "unavailable">>;
  /** Check the sign-up verification code. Success may or may not leave a session; callers re-read it with getSession. */
  verifyEmail(
    email: string,
    code: string,
  ): Promise<FlowResult<"invalid" | "locked" | "too-many" | "unavailable">>;
  /** Send a new verification code. Reports success for any address. */
  resendVerificationCode(email: string): Promise<FlowResult<"too-many" | "unavailable">>;
  /**
   * Email a reset LINK to `redirectTo` + `?token=...`. Reports success for any address. `redirectTo` is the app's own
   * /reset-password URL (it must be a trusted origin of the auth project).
   */
  requestPasswordReset(
    email: string,
    redirectTo: string,
  ): Promise<FlowResult<"too-many" | "unavailable">>;
  /** Choose a new password with the token from the emailed link. A used or expired token is "invalid". */
  resetPassword(
    token: string,
    newPassword: string,
  ): Promise<FlowResult<"weak-password" | "invalid" | "too-many" | "unavailable">>;
  /** End the current session (clears the session cookie). Safe to call when signed out. */
  signOut(): Promise<void>;
  /** Revoke every session except the current request's session. */
  revokeOtherSessions(): Promise<FlowResult<"unavailable">>;
  /** Permanently delete the current provider identity after verifying its current password. */
  deleteUser(password: string): Promise<FlowResult<"invalid" | "unavailable">>;
  /** True once app-data deletion has begun for this provider user id. Failures must reject access. */
  isAccountDeletionBlocked(userId: string): Promise<boolean>;
}
