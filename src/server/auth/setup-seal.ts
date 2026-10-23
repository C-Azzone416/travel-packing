// A signed "this link is for <address>" value carried on the reset link (`/reset-password?for=…&token=…`), so that using the
// link can record WHICH account was set up. The provider's reset call takes only the token and says nothing about whose it
// is. Only the app can make a seal (a keyed digest with a server secret) and it is only ever emailed to the address it names,
// so a stranger cannot mark someone else's account as set up. It expires with the link.
//
// The seal carries NO address, not even encoded (#210): it is `<expiry>.<digest>`, where the digest covers the address and the
// expiry. To read it, the app recomputes the digest for each address it could mean (the allowlist, a handful) and takes the
// one that matches. A copied link, browser history or an access log therefore shows a timestamp and a digest that cannot be
// turned back into an address without the server secret. Links in the older `<address>.<expiry>.<mac>` shape fail closed.

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./allowlist";

export const SEAL_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** A key for seals derived from the app secret, so the cookie secret itself is never used to sign anything else. */
export const sealKey = (secret: string) =>
  createHmac("sha256", secret).update("carrywell:setup-seal:v1").digest("hex");

export interface SetupSeals {
  seal(email: string): string;
  /**
   * The address a seal names, chosen from `candidates` (the allowed addresses), or null for a missing, altered, expired or
   * old-format one, or one that names none of them. The work is one digest per candidate.
   */
  open(value: unknown, candidates: Iterable<string>): string | null;
}

const DIGEST_LENGTH = 43; // base64url of a 32-byte SHA-256

export function createSetupSeals(secret: string, now: () => number = Date.now): SetupSeals {
  const digest = (email: string, expires: string) =>
    createHmac("sha256", secret).update(`setup-seal-v2|${email}|${expires}`).digest("base64url");
  return {
    seal(email) {
      const expires = String(now() + SEAL_LIFETIME_MS);
      return `${expires}.${digest(normalizeEmail(email), expires)}`;
    },
    open(value, candidates) {
      if (typeof value !== "string" || value.length > 100) return null;
      const parts = value.split(".");
      if (parts.length !== 2) return null;
      const [expires, given] = parts;
      if (!/^\d{1,16}$/.test(expires) || Number(expires) < now()) return null;
      if (given.length !== DIGEST_LENGTH) return null;
      const wanted = Buffer.from(given);
      // Every candidate is checked, in constant time each, so how long this takes does not say which one matched.
      let found: string | null = null;
      for (const candidate of candidates) {
        const email = normalizeEmail(candidate);
        if (timingSafeEqual(wanted, Buffer.from(digest(email, expires)))) found = email;
      }
      return found;
    },
  };
}

/** For a runtime with no secret (unavailable auth): seals nothing and opens nothing. */
export const NO_SEALS: SetupSeals = { seal: () => "", open: () => null };
