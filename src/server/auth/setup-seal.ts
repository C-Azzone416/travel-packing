// A signed "this link is for <address>" value carried on the reset link (`/reset-password?for=…&token=…`), so that using the
// link can record WHICH account was set up. The provider's reset call takes only the token and says nothing about whose it
// is. Only the app can make a seal (HMAC with a server secret) and it is only ever emailed to the address it names, so a
// stranger cannot mark someone else's account as set up. It expires with the link.

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./allowlist";

export const SEAL_LIFETIME_MS = 2 * 60 * 60 * 1000;

export interface SetupSeals {
  seal(email: string): string;
  /** The address a seal names, or null for a missing, altered or expired one. */
  open(value: unknown): string | null;
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const fromB64 = (text: string) => Buffer.from(text, "base64url").toString("utf8");

export function createSetupSeals(secret: string, now: () => number = Date.now): SetupSeals {
  const mac = (payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    seal(email) {
      const payload = `${b64(normalizeEmail(email))}.${now() + SEAL_LIFETIME_MS}`;
      return `${payload}.${mac(payload)}`;
    },
    open(value) {
      if (typeof value !== "string" || value.length > 600) return null;
      const parts = value.split(".");
      if (parts.length !== 3) return null;
      const [name, expires, given] = parts;
      const expected = mac(`${name}.${expires}`);
      const a = Buffer.from(given);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      if (!/^\d+$/.test(expires) || Number(expires) < now()) return null;
      const email = fromB64(name);
      return email.includes("@") ? email : null;
    },
  };
}

/** For a runtime with no secret (unavailable auth): seals nothing and opens nothing. */
export const NO_SEALS: SetupSeals = { seal: () => "", open: () => null };
