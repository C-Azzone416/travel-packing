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
//      reports a verified email (neon-adapter), the address is allowlisted, and (#83) the password was set through an
//      emailed link (account-setup.ts).
//   4. A sign-up code never signs anyone in (#83). It proves the inbox, then the person must choose their password through
//      a link emailed to that inbox, so a password set by someone else before verification can never be used.

import type { AccountSetupStore } from "./account-setup";
import { isAllowed, normalizeEmail, type Allowlist } from "./allowlist";
import { RESEND_COOLDOWN_SECONDS, type CodeKind, type FlowLimits } from "./flow-limits";
import { logAuthEvent } from "./safe-log";
import type { SetupSeals } from "./setup-seal";
import type { AuthProvider } from "./types";

type Auth = { provider: AuthProvider; allowlist: Allowlist };
/** What finishing a setup needs on top of Auth: where "set up" is recorded, and how a link names its address. */
type SetupAuth = Auth & { setup: AccountSetupStore; seals: SetupSeals };

/** The return address for a reset link: fixed, or made for the address it is sent to (so the link can name it). */
export type RedirectTo = string | ((email: string) => string);
const redirectFor = (redirectTo: RedirectTo, email: string) =>
  typeof redirectTo === "function" ? redirectTo(email) : redirectTo;

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
 * - invalid-email: fix the form
 * - rate-limited / unavailable: try again later
 */
export type SignUpOutcome =
  | { status: "ok"; email: string; cooldownSeconds: number }
  | { status: "invalid-email" }
  | RateLimited
  | { status: "unavailable" };

/**
 * The password the provider's sign-up call insists on (#102). Sign-up asks for an email only, so this is made here, from
 * 32 random bytes (43 characters, inside any password policy), handed to the provider and dropped. Nobody sees or uses
 * it: the person chooses the real password through the emailed link, which replaces this one.
 */
function throwawayPassword(): string {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export async function signUpOwner(
  auth: Auth,
  limits: FlowLimits,
  address: string,
  emailInput: unknown,
): Promise<SignUpOutcome> {
  const email = cleanEmail(emailInput);
  if (!email) return { status: "invalid-email" };
  if (!limits.signUp(address).ok) {
    logAuthEvent("flow-rate-limited");
    return { status: "rate-limited" };
  }
  // The first send counts toward the 30-second gap. If a code was just sent (or the hourly cap is reached) the screen
  // still moves on, and nothing more is sent. WHY nothing was sent is logged below (server-only, no address, no secret):
  // the browser gets the same answer in every case.
  const allowance = limits.send("verify", email, address);
  if (!allowance.ok) {
    logAuthEvent(
      allowance.reason === "cooldown" ? "sign-up-skipped-cooldown" : "sign-up-skipped-limit",
    );
  } else if (!isAllowed(auth.allowlist, email)) {
    logAuthEvent("sign-up-skipped-allowlist");
  } else {
    const result = await auth.provider.signUp(email, throwawayPassword());
    if (!result.ok) {
      // Even "weak-password" is a server problem now: the person typed no password, so there is nothing for them to fix.
      logAuthEvent("sign-up-failed");
      return { status: "unavailable" };
    }
    // The provider answered. A client error (a 4xx, e.g. an untrusted origin or a taken address) looks like success to the
    // person, but it did not send a code, so it is logged apart from a real success.
    if (result.rejected) logAuthEvent("sign-up-provider-rejected", result.rejected);
    else logAuthEvent("sign-up-provider-ok");
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
  const label = kind === "verify" ? "code-send" : "reset-send";
  const allowance = limits.send(kind, email, address);
  if (!allowance.ok) {
    logAuthEvent("flow-rate-limited");
    logAuthEvent(`${label}-skipped-${allowance.reason === "cooldown" ? "cooldown" : "limit"}`);
    return allowance.reason === "cooldown"
      ? { status: "cooldown", retryAfterSeconds: allowance.retryAfterSeconds }
      : { status: "rate-limited" };
  }
  if (!isAllowed(auth.allowlist, email)) {
    logAuthEvent(`${label}-skipped-allowlist`);
  } else {
    const result = await send(email);
    if (!result.ok) {
      logAuthEvent(`${label}-provider-failed`);
      // A provider limit reads the same as ours; the 30-second gap just started either way.
      return result.reason === "too-many" ? { status: "rate-limited" } : { status: "unavailable" };
    }
    if (result.rejected) logAuthEvent(`${label}-provider-rejected`, result.rejected);
    else logAuthEvent(`${label}-provider-ok`);
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

/**
 * `redirectTo` is the app's own /reset-password URL (or a function making it for the address); the emailed link brings the
 * person back to it with a token. The same link serves "forgot password" and "finish setting up".
 */
export const requestPasswordReset = (
  auth: Auth,
  limits: FlowLimits,
  address: string,
  email: unknown,
  redirectTo: RedirectTo,
) =>
  sendTo(auth, limits, address, "reset", email, (clean) =>
    auth.provider.requestPasswordReset(clean, redirectFor(redirectTo, clean)),
  );

// ---- verification --------------------------------------------------------------------------------------------------------

/**
 * - finish-setup: the code was right. No session was started (any the provider made is ended); a link to choose the password
 *   has been emailed (or was just sent), and the person is told to check their email
 * - invalid: wrong, expired, used or missing code (one message for all of them)
 * - locked: five wrong codes; a new code is needed
 */
export type VerifyOutcome =
  | { status: "finish-setup"; email: string; cooldownSeconds: number }
  | { status: "invalid" }
  | { status: "locked" }
  | RateLimited
  | { status: "unavailable" };

export async function verifyOwnerEmail(
  auth: Auth,
  limits: FlowLimits,
  address: string,
  emailInput: unknown,
  codeInput: unknown,
  redirectTo: RedirectTo,
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
  // The address is now verified, but the password on the account is whatever was typed at sign-up, by whoever typed it. So no
  // session comes out of this step, however the provider behaves (it may sign the person in on its own): end any it made,
  // and make the person choose a password through a link emailed to this inbox.
  try {
    await auth.provider.signOut();
  } catch {
    logAuthEvent("provider-error");
  }
  const sent = await sendTo(auth, limits, address, "reset", email, (clean) =>
    auth.provider.requestPasswordReset(clean, redirectFor(redirectTo, clean)),
  );
  // A link that is already on its way (asked a moment ago), a cap, or an outage all end up on the same screen: "check your
  // email", with a resend that says what is wrong if it is not working.
  return {
    status: "finish-setup",
    email,
    cooldownSeconds:
      sent.status === "ok" ? sent.cooldownSeconds : limits.cooldownRemaining("reset", email),
  };
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
 * Choose a new password with the token from the emailed link, and record that the account is set up. Success ends this
 * browser's session and does NOT sign anyone in: the person signs in with the new password, so verification and the
 * allowlist are checked again. Ending
 * OTHER sessions is the provider's job (its reset endpoint); see docs/auth-screens.md.
 */
export async function resetOwnerPassword(
  auth: SetupAuth,
  tokenInput: unknown,
  newPassword: unknown,
  /** The `for` value from the link: a seal naming the address the link was emailed to. */
  sealedAddress?: unknown,
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
  // Using a link proves the inbox, so this is the moment the account counts as set up (#83). Only the app can make the seal,
  // it is only ever emailed to the address it names, and only allowlisted addresses are ever recorded. Without a good seal
  // (an old link, including one in the shape used before #210) the password still changes, but the account stays "not set up"
  // until a new link is used.
  const address = auth.seals.open(sealedAddress, auth.allowlist);
  if (address && isAllowed(auth.allowlist, address)) {
    try {
      await auth.setup.markComplete(address);
      logAuthEvent("account-setup-completed");
    } catch {
      logAuthEvent("provider-error");
    }
  }
  logAuthEvent("password-reset-succeeded");
  return { status: "ok" };
}
