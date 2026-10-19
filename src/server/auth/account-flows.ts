// The account flows behind the sign-up, verification, forgot-password and reset screens (#27). Kept apart from Next.js so
// they can be tested directly. Three rules run through all of it:
//   1. Enumeration-safe. Nothing returned says whether an address has an account or is allowed in. A taken address looks
//      like a new one, asking for a code or link succeeds for any address, and a code that is wrong, expired, used or
//      for an unknown address is the same "invalid". The only differences a person sees come from limits that apply to
//      every address alike (the 30-second gap, the hourly caps, five wrong codes).
//   2. Only allowlisted addresses reach the provider. For any other address the screens behave identically but nothing is
//      created, mailed or verified, and the code step simply never succeeds (design addendum on #27). This also keeps
//      strangers from filling the auth project's user table and mailbox.
//   3. Verification and the allowlist stay the gate. Nothing here grants access: a session exists only if the provider
//      reports a verified email (neon-adapter), and a verified address that is not allowlisted is signed straight back
//      out, exactly as sign-in does.

import { isAllowed, normalizeEmail, type Allowlist } from "./allowlist";
import { RESEND_COOLDOWN_SECONDS, type CodeKind, type FlowLimits } from "./flow-limits";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider } from "./types";

type Auth = { provider: AuthProvider; allowlist: Allowlist };

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const CODE_LENGTH = 6;
/** What the screens tell people about expiry; the provider's own settings decide the real lifetime. */
export const CODE_LIFETIME_MINUTES = 10;
export const RESET_LIFETIME_HOURS = 1;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_SHAPE = new RegExp(`^\\d{${CODE_LENGTH}}$`);
/** Reset tokens are opaque; this only rejects empty or oversized input before it goes anywhere. */
const TOKEN_SHAPE = /^[A-Za-z0-9._~-]{8,512}$/;

/** A real-looking address, or null. Light on purpose: the provider has the final say. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_SHAPE.test(email) ? email : null;
}

/** The digits of a code typed with spaces or dashes ("123 456"), or null if it cannot be a code. */
export function cleanCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/[\s-]/g, "");
  return CODE_SHAPE.test(code) ? code : null;
}

export function cleanToken(value: unknown): string | null {
  return typeof value === "string" && TOKEN_SHAPE.test(value) ? value : null;
}

export type PasswordProblem = "missing" | "too-short" | "too-long";

export function passwordProblem(value: unknown): PasswordProblem | null {
  if (typeof value !== "string" || !value) return "missing";
  if (value.length < MIN_PASSWORD_LENGTH) return "too-short";
  return value.length > MAX_PASSWORD_LENGTH ? "too-long" : null;
}

/** The wait before another code or link may be requested; the screens show it as a countdown. */
export type Cooldown = { status: "cooldown"; retryAfterSeconds: number };
/** An hourly cap, or the provider's own limit: "try again in a few minutes". */
export type RateLimited = { status: "rate-limited" };

// ---- sign-up -------------------------------------------------------------------------------------------------------

/**
 * - ok: the verification step comes next, whether or not the address was already registered or allowed
 * - invalid-email / weak-password: fix the form
 * - rate-limited / unavailable: try again later
 */
export type SignUpOutcome =
  | { status: "ok"; email: string; cooldownSeconds: number }
  | { status: "invalid-email" }
  | { status: "weak-password"; problem: PasswordProblem | "provider" }
  | RateLimited
  | { status: "unavailable" };

export async function signUpOwner(
  auth: Auth,
  limits: FlowLimits,
  address: string,
  emailInput: unknown,
  password: unknown,
): Promise<SignUpOutcome> {
  const email = cleanEmail(emailInput);
  if (!email) return { status: "invalid-email" };
  const problem = passwordProblem(password);
  if (problem) return { status: "weak-password", problem };
  if (!limits.signUp(address).ok) {
    logAuthEvent("flow-rate-limited");
    return { status: "rate-limited" };
  }
  // The first send counts toward the 30-second gap. If a code was just sent (or the hourly cap is reached) the screen
  // still moves on, and nothing more is sent.
  const mayCreate = limits.send("verify", email, address).ok && isAllowed(auth.allowlist, email);
  if (mayCreate) {
    const result = await auth.provider.signUp(email, password as string);
    if (!result.ok) {
      logAuthEvent("sign-up-failed");
      return result.reason === "weak-password"
        ? { status: "weak-password", problem: "provider" }
        : { status: "unavailable" };
    }
    limits.clearGuesses(email);
  }
  logAuthEvent("sign-up-requested");
  return { status: "ok", email, cooldownSeconds: limits.cooldownRemaining("verify", email) };
}

// ---- sending a code or link ------------------------------------------------------------------------------------------

/** ok means "a code or link is on its way if this address can receive one", for every address. */
export type SendOutcome =
  | { status: "ok"; email: string; cooldownSeconds: number }
  | { status: "invalid-email" }
  | Cooldown
  | RateLimited
  | { status: "unavailable" };

async function sendTo(
  auth: Auth,
  limits: FlowLimits,
  address: string,
  kind: CodeKind,
  emailInput: unknown,
  send: (email: string) => ReturnType<AuthProvider["resendVerificationCode"]>,
): Promise<SendOutcome> {
  const email = cleanEmail(emailInput);
  if (!email) return { status: "invalid-email" };
  const allowance = limits.send(kind, email, address);
  if (!allowance.ok) {
    logAuthEvent("flow-rate-limited");
    return allowance.reason === "cooldown"
      ? { status: "cooldown", retryAfterSeconds: allowance.retryAfterSeconds }
      : { status: "rate-limited" };
  }
  if (isAllowed(auth.allowlist, email)) {
    const result = await send(email);
    if (!result.ok) {
      // A provider limit reads the same as ours; the 30-second gap just started either way.
      return result.reason === "too-many" ? { status: "rate-limited" } : { status: "unavailable" };
    }
    if (kind === "verify") limits.clearGuesses(email);
  }
  logAuthEvent(kind === "verify" ? "code-sent" : "password-reset-requested");
  return { status: "ok", email, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
}

export const resendVerificationCode = (
  auth: Auth,
  limits: FlowLimits,
  address: string,
  email: unknown,
) =>
  sendTo(auth, limits, address, "verify", email, (clean) =>
    auth.provider.resendVerificationCode(clean),
  );

/** `redirectTo` is the app's own /reset-password URL; the emailed link brings the person back to it with a token. */
export const requestPasswordReset = (
  auth: Auth,
  limits: FlowLimits,
  address: string,
  email: unknown,
  redirectTo: string,
) =>
  sendTo(auth, limits, address, "reset", email, (clean) =>
    auth.provider.requestPasswordReset(clean, redirectTo),
  );

// ---- verification --------------------------------------------------------------------------------------------------------

/**
 * - signed-in: verified and the address is allowlisted; the provider already started the session
 * - verified: verified, but no session yet; the person signs in with the password they chose
 * - denied: verified, but not on the allowlist; the session (if any) has been ended
 * - invalid: wrong, expired, used or missing code (one message for all of them)
 * - locked: five wrong codes; a new code is needed
 */
export type VerifyOutcome =
  | { status: "signed-in" }
  | { status: "verified" }
  | { status: "denied" }
  | { status: "invalid" }
  | { status: "locked" }
  | RateLimited
  | { status: "unavailable" };

export async function verifyOwnerEmail(
  auth: Auth,
  limits: FlowLimits,
  emailInput: unknown,
  codeInput: unknown,
): Promise<VerifyOutcome> {
  const email = cleanEmail(emailInput);
  if (!email) return { status: "invalid" };
  if (!limits.guessBlocked(email).ok) {
    logAuthEvent("flow-rate-limited");
    return { status: "locked" };
  }
  const code = cleanCode(codeInput);
  // A non-allowlisted address is never asked of the provider: its code can never be right, and it is counted like any
  // other wrong guess so the lock arrives at the same time.
  if (!code || !isAllowed(auth.allowlist, email)) {
    limits.recordWrongGuess(email);
    logAuthEvent("verification-failed");
    return { status: "invalid" };
  }
  const result = await auth.provider.verifyEmail(email, code);
  if (!result.ok) {
    if (result.reason === "unavailable") return { status: "unavailable" };
    logAuthEvent("verification-failed");
    if (result.reason === "too-many") return { status: "rate-limited" };
    limits.recordWrongGuess(email);
    return { status: result.reason === "locked" ? "locked" : "invalid" };
  }
  limits.clearGuesses(email);
  logAuthEvent("verification-succeeded");
  // Whether verifying also signs the person in is up to the provider; ask rather than assume. getSession only ever
  // returns a verified session, and the allowlist still applies to it.
  let session;
  try {
    session = await auth.provider.getSession();
  } catch {
    logAuthEvent("provider-error");
    return { status: "verified" };
  }
  if (!session) return { status: "verified" };
  if (!isAllowed(auth.allowlist, session.email)) {
    logAuthEvent("verification-denied");
    try {
      await auth.provider.signOut();
    } catch {
      logAuthEvent("provider-error");
    }
    return { status: "denied" };
  }
  return { status: "signed-in" };
}

// ---- reset ---------------------------------------------------------------------------------------------------------------

/**
 * - ok: the password changed; the person signs in with it
 * - invalid-link: the link is missing, wrong, expired or already used (one screen for all of them)
 */
export type ResetOutcome =
  | { status: "ok" }
  | { status: "invalid-link" }
  | { status: "weak-password"; problem: PasswordProblem | "provider" }
  | RateLimited
  | { status: "unavailable" };

/**
 * Choose a new password with the token from the emailed link. Success ends this browser's session and does NOT sign
 * anyone in: the person signs in with the new password, so verification and the allowlist are checked again. Ending
 * OTHER sessions is the provider's job (its reset endpoint); see docs/auth-screens.md.
 */
export async function resetOwnerPassword(
  auth: Auth,
  tokenInput: unknown,
  newPassword: unknown,
): Promise<ResetOutcome> {
  const problem = passwordProblem(newPassword);
  if (problem) return { status: "weak-password", problem };
  const token = cleanToken(tokenInput);
  if (!token) {
    logAuthEvent("password-reset-failed");
    return { status: "invalid-link" };
  }
  const result = await auth.provider.resetPassword(token, newPassword as string);
  if (!result.ok) {
    if (result.reason === "unavailable") return { status: "unavailable" };
    logAuthEvent("password-reset-failed");
    if (result.reason === "weak-password") return { status: "weak-password", problem: "provider" };
    return result.reason === "too-many" ? { status: "rate-limited" } : { status: "invalid-link" };
  }
  try {
    await auth.provider.signOut();
  } catch {
    logAuthEvent("provider-error");
  }
  logAuthEvent("password-reset-succeeded");
  return { status: "ok" };
}
