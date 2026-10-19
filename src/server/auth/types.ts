// Auth contract the app depends on. The managed provider (Neon Auth / Better Auth) sits behind it, so unit
// tests use a fake and make no network calls. The provider works on the ambient request: cookies are read and
// written by the adapter (Next.js server context), never handled by app code.

export interface AuthSession {
  userId: string;
  email: string;
}

/**
 * `unverified` means the password was RIGHT but the address is not verified yet. It is only ever reported after the
 * password matched, so it tells a caller nothing about accounts they cannot already sign in to.
 * `unfinished` is the same for a verified address whose password was never set through an emailed link (#83): no session.
 */
export type SignInResult =
  { ok: true; session: AuthSession } | { ok: false; unverified?: true; unfinished?: true };

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

export type FlowResult<Reason extends FlowFailure = FlowFailure> =
  { ok: true } | { ok: false; reason: Reason };

export interface AuthProvider {
  /** The current request's session, or null when signed out. */
  getSession(): Promise<AuthSession | null>;
  /** Email + password sign-in. A failure never says which part was wrong. */
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
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
}
