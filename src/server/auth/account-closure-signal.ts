import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS = 5 * 60 * 1000;

/** A short-lived, identity-free proof that the provider confirmed terminal account deletion. */
export interface AccountClosureSignals {
  issue(): string;
  open(value: unknown): boolean;
}

export const accountClosureSignalKey = (secret: string): string =>
  createHmac("sha256", secret).update("packed-smart:account-closure-signal:v1").digest("hex");

const NONCE_SHAPE = /^[A-Za-z0-9_-]{32}$/;
const DIGEST_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function createAccountClosureSignals(
  secret: string,
  now: () => number = Date.now,
  nonce: () => string = () => randomBytes(24).toString("base64url"),
): AccountClosureSignals {
  const digest = (expires: string, random: string) =>
    createHmac("sha256", secret)
      .update(`account-closure-v1|${expires}|${random}`)
      .digest("base64url");

  return {
    issue() {
      const expires = String(now() + ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS);
      const random = nonce();
      if (!NONCE_SHAPE.test(random)) throw new Error("account closure nonce has an invalid shape");
      return `v1.${expires}.${random}.${digest(expires, random)}`;
    },
    open(value) {
      if (typeof value !== "string" || value.length > 160) return false;
      const [version, expires, random, given, extra] = value.split(".");
      if (
        extra !== undefined ||
        version !== "v1" ||
        !/^\d{1,16}$/.test(expires ?? "") ||
        Number(expires) < now() ||
        !NONCE_SHAPE.test(random ?? "") ||
        !DIGEST_SHAPE.test(given ?? "")
      ) {
        return false;
      }
      return timingSafeEqual(Buffer.from(given), Buffer.from(digest(expires, random)));
    },
  };
}

export const NO_ACCOUNT_CLOSURE_SIGNALS: AccountClosureSignals = {
  issue: () => "",
  open: () => false,
};
