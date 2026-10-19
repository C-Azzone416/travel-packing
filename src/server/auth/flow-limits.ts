// Limits for the account screens (#27): sign-up, resending a code or link, asking for a password reset, and guessing a
// verification code. They protect the provider's mailbox and the owner's patience, so they never depend on whether an
// address has an account: a cooldown on an unknown address is the same as on a real one, which keeps the screens
// enumeration-safe.
//   - sending a code or link (verification or reset): one per 30 seconds per address and kind (the first send counts),
//     5 per hour per address and kind, 20 per hour per caller
//   - sign-up: 10 per hour per caller
//   - guessing a verification code: 5 FAILED tries per 15 minutes per address; a success OR a newly sent code clears it
// State is per server instance (memory), like the sign-in limits; a shared limit is Caroline's call (#28).

import { createRateLimiter, type RateLimiter } from "@/server/locations/rate-limit";
import { normalizeEmail } from "./allowlist";

export type CodeKind = "verify" | "reset";

export const RESEND_COOLDOWN_MS = 30 * 1000;
export const RESEND_COOLDOWN_SECONDS = RESEND_COOLDOWN_MS / 1000;
export const SENDS_PER_HOUR = 5;
export const SENDS_PER_CALLER_PER_HOUR = 20;
export const SIGN_UPS_PER_CALLER_PER_HOUR = 10;
export const CODE_GUESSES = 5;
export const CODE_GUESS_WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type LimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Why a send was refused: "cooldown" is the 30-second gap (the screen counts it down), "limit" an hourly cap. */
export type SendDecision =
  { ok: true } | { ok: false; reason: "cooldown" | "limit"; retryAfterSeconds: number };

export interface FlowLimits {
  /** Counts one sign-up from this caller; refuses past the hourly allowance. */
  signUp(address: string): LimitDecision;
  /** Counts one code or link email for this address and kind; refuses inside the gap or past an hourly cap. */
  send(kind: CodeKind, email: string, address: string): SendDecision;
  /** Whole seconds left before another send is allowed for this address and kind (0 = now). Counts nothing. */
  cooldownRemaining(kind: CodeKind, email: string): number;
  /** Whether guessing a verification code is blocked for this address. Counts nothing. */
  guessBlocked(email: string): LimitDecision;
  recordWrongGuess(email: string): void;
  clearGuesses(email: string): void;
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * The per-caller allowance for sign-ups an hour, from AUTH_FLOW_CALLERS_PER_HOUR (default 10; code and link emails get
 * twice that). A bad value never switches the limit off. The browser tests raise it because every test comes from one address.
 */
export function callerAllowancePerHour(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AUTH_FLOW_CALLERS_PER_HOUR?.trim() ?? "";
  if (!/^\d{1,5}$/.test(raw)) return SIGN_UPS_PER_CALLER_PER_HOUR;
  const value = Number(raw);
  return value >= 1 && value <= 10_000 ? value : SIGN_UPS_PER_CALLER_PER_HOUR;
}

export function createFlowLimits(
  now: () => number = Date.now,
  callerAllowance: number = SIGN_UPS_PER_CALLER_PER_HOUR,
): FlowLimits {
  const make = (limit: number, windowMs: number): RateLimiter =>
    createRateLimiter({ limit, windowMs, now });
  const signUps = make(callerAllowance, HOUR_MS);
  const gap = make(1, RESEND_COOLDOWN_MS);
  const hourly = make(SENDS_PER_HOUR, HOUR_MS);
  const perCaller = make(
    callerAllowance * (SENDS_PER_CALLER_PER_HOUR / SIGN_UPS_PER_CALLER_PER_HOUR),
    HOUR_MS,
  );
  const guesses = make(CODE_GUESSES, CODE_GUESS_WINDOW_MS);
  const key = (kind: CodeKind, email: string) => `${kind}|${normalizeEmail(email)}`;
  const wait = (decision: ReturnType<RateLimiter["peek"]>): LimitDecision =>
    decision.ok ? decision : { ok: false, retryAfterSeconds: seconds(decision.retryAfterMs) };
  return {
    signUp: (address) => wait(signUps.consume(address)),
    send(kind, email, address) {
      const k = key(kind, email);
      // Peek everything first so a refused request counts against nothing.
      const gapCheck = gap.peek(k);
      if (!gapCheck.ok) {
        return { ok: false, reason: "cooldown", retryAfterSeconds: seconds(gapCheck.retryAfterMs) };
      }
      const capped = [hourly.peek(k), perCaller.peek(address)].find((check) => !check.ok);
      if (capped && !capped.ok) {
        return { ok: false, reason: "limit", retryAfterSeconds: seconds(capped.retryAfterMs) };
      }
      gap.consume(k);
      hourly.consume(k);
      perCaller.consume(address);
      return { ok: true };
    },
    cooldownRemaining(kind, email) {
      const check = wait(gap.peek(key(kind, email)));
      return check.ok ? 0 : check.retryAfterSeconds;
    },
    guessBlocked: (email) => wait(guesses.peek(normalizeEmail(email))),
    recordWrongGuess: (email) => void guesses.consume(normalizeEmail(email)),
    clearGuesses: (email) => guesses.clear(normalizeEmail(email)),
  };
}

let shared: FlowLimits | undefined;

/** The app-wide limits, created on first use. */
export function flowLimits(): FlowLimits {
  shared ??= createFlowLimits(Date.now, callerAllowancePerHour());
  return shared;
}

/** Test hook: forget all counts. */
export function resetFlowLimits(): void {
  shared = undefined;
}
