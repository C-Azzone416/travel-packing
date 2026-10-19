// A fingerprint of the owner allowlist, so two copies of it (the one Vercel serves the running app, the one GitHub's preview
// environment holds for the deploy) can be compared WITHOUT printing either. Both copies are write-only secrets, so a person
// can never read them side by side; a short keyed digest of each can be compared instead (#93).
//
// - It is an HMAC keyed with a key derived from NEON_AUTH_COOKIE_SECRET, so it cannot be tested against guessed addresses
//   without that secret, and it carries no address. It is 12 hex characters (48 bits): enough to tell two lists apart,
//   far too little to recover anything from.
// - It is computed over the normalized, de-duplicated, sorted addresses, so order, case and spacing do not matter.
// - Because the key comes from the cookie secret, two copies match only if BOTH the allowlist and the cookie secret are the
//   same on both sides, which is exactly the alignment the deploy needs (a mismatch means rotate both together).
// - It is logged by the running app once at start (event allowlist-loaded) and printed by the deploy job's injection step.
//   It answers "are the two copies the same?" and nothing about any address, and no endpoint serves it.

import { createHmac } from "node:crypto";
import { isPlainEmail, parseAllowlist, type Allowlist } from "./allowlist";

const FINGERPRINT_LENGTH = 12;

function fingerprintKey(cookieSecret: string): string {
  return createHmac("sha256", cookieSecret)
    .update("carrywell:allowlist-fingerprint:v1")
    .digest("hex");
}

export function allowlistFingerprint(allowlist: Allowlist, cookieSecret: string): string {
  const entries = [...allowlist].sort().join("\n");
  return createHmac("sha256", fingerprintKey(cookieSecret))
    .update(entries)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/** How many entries are not plain addresses (quoted, wrapped in brackets, a stray word...). A count only, never the entry. */
export function malformedEntries(allowlist: Allowlist): number {
  return [...allowlist].filter((entry) => !isPlainEmail(entry)).length;
}

/** The count, the number of malformed entries and the fingerprint of an OWNER_EMAIL_ALLOWLIST value, parsed the way the app parses it. */
export function describeAllowlist(
  raw: string | undefined,
  cookieSecret: string,
): { entries: number; malformed: number; fingerprint: string } {
  const allowlist = parseAllowlist(raw);
  return {
    entries: allowlist.size,
    malformed: malformedEntries(allowlist),
    fingerprint: allowlistFingerprint(allowlist, cookieSecret),
  };
}
