// Sign-in guessing limits (#22). They count FAILED attempts only, so a person who knows the owner's email cannot lock
// the owner out by trying wrong passwords from somewhere else:
//   - per (email, address): 10 failures per 15 minutes. The lockout is keyed on the PAIR, so failures from address A never
//     block the same email from address B. A success clears the pair's count.
//   - per email, 5x as loose (a backstop against guessing spread over many addresses).
//   - per address, 4x as loose (one address trying many accounts).
// The caller asks `blocked` BEFORE looking at the credentials, then records the outcome. State is per server instance
// (memory); a limit shared across instances needs a store the app does not have, which is a decision for Caroline (#28).
// SIGN_IN_ATTEMPTS_PER_15_MIN raises the base number (a bad value never switches the limit off).

import { createRateLimiter, type RateLimiter } from "@/server/locations/rate-limit";

export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_SIGN_IN_ATTEMPTS = 10;
export const EMAIL_BACKSTOP_FACTOR = 5;
export const ADDRESS_ALLOWANCE_FACTOR = 4;

export function signInAttemptsPerWindow(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SIGN_IN_ATTEMPTS_PER_15_MIN?.trim() ?? "";
  if (!/^\d{1,5}$/.test(raw)) return DEFAULT_SIGN_IN_ATTEMPTS;
  const value = Number(raw);
  return value >= 1 && value <= 10_000 ? value : DEFAULT_SIGN_IN_ATTEMPTS;
}

export interface SignInLimits {
  /** True if guessing is currently blocked for this email from this address. Counts nothing. */
  blocked(email: string, address: string): boolean;
  /** A wrong password (or a valid account that is not allowed in): counts against the pair, the email and the address. */
  recordFailure(email: string, address: string): void;
  /** A successful sign-in: clears the pair's failures (the email and address counts keep ageing out on their own). */
  recordSuccess(email: string, address: string): void;
}

const normalize = (email: string) => email.trim().toLowerCase();

export function createSignInLimits(
  attempts: number = DEFAULT_SIGN_IN_ATTEMPTS,
  now: () => number = Date.now,
): SignInLimits {
  const make = (limit: number): RateLimiter =>
    createRateLimiter({ limit, windowMs: SIGN_IN_WINDOW_MS, now });
  const perPair = make(attempts);
  const perEmail = make(attempts * EMAIL_BACKSTOP_FACTOR);
  const perAddress = make(attempts * ADDRESS_ALLOWANCE_FACTOR);
  const pair = (email: string, address: string) => `${normalize(email)}|${address}`;
  return {
    blocked(email, address) {
      return (
        !perPair.peek(pair(email, address)).ok ||
        !perEmail.peek(normalize(email)).ok ||
        !perAddress.peek(address).ok
      );
    },
    recordFailure(email, address) {
      perPair.consume(pair(email, address));
      perEmail.consume(normalize(email));
      perAddress.consume(address);
    },
    recordSuccess(email, address) {
      perPair.clear(pair(email, address));
    },
  };
}

/**
 * The caller's address from the proxy headers. Taking the FIRST x-forwarded-for entry is correct only because Vercel
 * overwrites that header with the real client address; if the app is ever hosted elsewhere, revisit this. "unknown"
 * shares one bucket rather than skipping the limit.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

let shared: SignInLimits | undefined;

/** The app-wide limiter, created on first use from the environment. */
export function signInLimits(): SignInLimits {
  shared ??= createSignInLimits(signInAttemptsPerWindow());
  return shared;
}

/** Test hook: forget all counts. */
export function resetSignInLimits(): void {
  shared = undefined;
}
